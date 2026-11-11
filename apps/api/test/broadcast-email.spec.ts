import { BadRequestException, ConflictException } from '@nestjs/common';
import { BroadcastEmailService, personalize } from '../src/broadcast-email/broadcast-email.service';

// 11/11/2026: comunicado em massa. Banco e e-mail FALSOS (nada real e' enviado).
interface Log { userId: string; trigger: string; status: string }

function build(students: Array<{ id: string; name: string | null }>, preLogs: Log[] = [], failFor: string[] = []) {
  const logs: Log[] = [...preLogs];
  const sentTo: string[] = [];
  const prisma = {
    user: { findMany: jest.fn(async () => students) },
    messageLog: {
      findMany: jest.fn(async ({ where }: { where: { trigger: string; userId: { in: string[] } } }) => logs.filter((l) => l.trigger === where.trigger && where.userId.in.includes(l.userId))),
      findFirst: jest.fn(async ({ where }: { where: { userId: string; trigger: string; status: string } }) => logs.find((l) => l.userId === where.userId && l.trigger === where.trigger && l.status === where.status) ?? null),
    },
  };
  const messaging = {
    sendEmail: jest.fn(async (userId: string, params: { trigger: string; content: string }) => {
      const ok = !failFor.includes(userId);
      logs.push({ userId, trigger: params.trigger, status: ok ? 'sent' : 'failed' });
      if (ok) sentTo.push(`${userId}|${params.content}`);
      return { ok };
    }),
  };
  const service = new BroadcastEmailService(prisma as never, messaging as never);
  return { service, messaging, sentTo, logs };
}

const input = { key: 'versao-1-0-4', subject: 'Assunto', message: 'Olá, {nome}! Atualize.' };
const students = [{ id: 'a', name: 'Maria Silva' }, { id: 'b', name: 'Ana Souza' }, { id: 'c', name: null }];
const waitDone = async (service: BroadcastEmailService) => { for (let i = 0; i < 100; i++) { if (!(service as unknown as { running: string | null }).running) return; await new Promise((r) => setTimeout(r, 50)); } };

describe('personalizacao do comunicado', () => {
  it('{nome} vira o primeiro nome; sem nome, a saudacao fica sem virgula solta', () => {
    expect(personalize('Olá, {nome}! Oi.', 'Maria Silva')).toBe('Olá, Maria! Oi.');
    expect(personalize('Olá, {nome}! Oi.', null)).toBe('Olá! Oi.');
    expect(personalize('Sem marcador', 'Ana')).toBe('Sem marcador');
  });
});

describe('BroadcastEmailService', () => {
  it('recusa chave, assunto ou mensagem invalidos', async () => {
    const { service } = build(students);
    await expect(service.preview({ ...input, key: 'AB' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.preview({ ...input, subject: '  ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.preview({ ...input, message: '' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preview conta so quem ainda nao recebeu e NAO envia nada', async () => {
    const { service, messaging } = build(students, [{ userId: 'a', trigger: 'broadcast:versao-1-0-4', status: 'sent' }]);
    const preview = await service.preview(input);
    expect(preview).toMatchObject({ eligible: 3, alreadySent: 1, pending: 2 });
    expect(messaging.sendEmail).not.toHaveBeenCalled();
  });

  it('envio exige a contagem exata confirmada', async () => {
    const { service, messaging } = build(students);
    await expect(service.start(input, 2)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.start(input, NaN)).rejects.toBeInstanceOf(BadRequestException);
    expect(messaging.sendEmail).not.toHaveBeenCalled();
  });

  it('envia a todas com o nome de cada uma; segunda chamada nao repete; falha nao derruba as outras e e reenviavel so para quem falta', async () => {
    jest.useRealTimers();
    const { service, messaging, sentTo, logs } = build(students, [], ['b']);
    const started = await service.start(input, 3);
    expect(started).toEqual({ started: true, total: 3 });
    await expect(service.start(input, 3)).rejects.toBeInstanceOf(ConflictException); // trava de envio simultaneo
    await waitDone(service);
    expect(sentTo).toEqual(['a|Olá, Maria! Atualize.', 'c|Olá! Atualize.']);
    expect(messaging.sendEmail).toHaveBeenCalledTimes(3);
    expect(await service.status(input.key)).toMatchObject({ alreadySent: 2, failed: 1, pending: 1, running: false });
    // reenvio: so' a aluna que falhou ('b'), agora com sucesso
    logs.length = 0; logs.push({ userId: 'a', trigger: 'broadcast:versao-1-0-4', status: 'sent' }, { userId: 'c', trigger: 'broadcast:versao-1-0-4', status: 'sent' });
    messaging.sendEmail.mockClear();
    await expect(service.start(input, 3)).rejects.toBeInstanceOf(BadRequestException); // contagem agora e' 1
    await service.start(input, 1);
    await waitDone(service);
    expect(messaging.sendEmail).toHaveBeenCalledTimes(1);
    await expect(service.start(input, 0)).rejects.toThrow(); // todas ja receberam
  }, 15000);

  it('teste vai so para o treinador', async () => {
    const { service, messaging } = build(students);
    await service.sendTestToCoach('coach-1', input);
    expect(messaging.sendEmail).toHaveBeenCalledTimes(1);
    expect(messaging.sendEmail.mock.calls[0][0]).toBe('coach-1');
  });
});
