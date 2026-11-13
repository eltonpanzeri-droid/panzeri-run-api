import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthService } from '../src/auth/auth.service';
import { isValidCpf, normalizeBrPhone } from '../src/common/short-signup';

// Cadastro curto antes do pagamento (13/11/2026): nome, e-mail, telefone e CPF. O register REAL e' executado com banco, JWT, Meta e Telegram FALSOS.
const VALID_CPF = '529.982.247-25'; // CPF de teste com digitos verificadores validos
const base = { email: 'ana@example.com', password: 'senha-forte-1', name: ' Ana Souza ', acceptedTerms: true, acceptedExerciseResponsibility: true };

function build(over: { existingEmails?: string[]; cpfTaken?: boolean; createError?: unknown } = {}) {
  const created: any[] = [];
  const prisma: any = {
    user: {
      findMany: jest.fn(async () => (over.existingEmails ?? []).map((email) => ({ email }))),
      findFirst: jest.fn(async () => (over.cpfTaken ? { id: 'outra' } : null)),
      update: jest.fn(async () => ({})),
      create: jest.fn(async ({ data }: any) => { if (over.createError) throw over.createError; created.push(data); return { id: 'u1', email: data.email, role: 'student', name: data.name }; }),
    },
  };
  const jwt = { signAsync: jest.fn(async () => 'tok') };
  const config = { get: jest.fn() };
  const meta = { sendEvent: jest.fn() };
  const telegram = { notifyCoach: jest.fn(async () => undefined) };
  const service = new AuthService(prisma, jwt as never, config as never, meta as never, undefined, telegram as never);
  return { service, prisma, created, telegram };
}

describe('validacao do cadastro curto', () => {
  it('CPF: aceita valido (com ou sem pontuacao); recusa digito errado, repetido e tamanho errado', () => {
    expect(isValidCpf(VALID_CPF)).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('1234')).toBe(false);
    expect(isValidCpf(undefined)).toBe(false);
  });
  it('telefone: celular/fixo com DDD, aceita +55 e mascara; recusa curto e celular sem 9', () => {
    expect(normalizeBrPhone('(11) 91234-5678')).toBe('11912345678');
    expect(normalizeBrPhone('+55 11 91234-5678')).toBe('11912345678');
    expect(normalizeBrPhone('1133334444')).toBe('1133334444');
    expect(normalizeBrPhone('91234-5678')).toBeNull();
    expect(normalizeBrPhone('11812345678')).toBeNull();
    expect(normalizeBrPhone(undefined)).toBeNull();
  });
});

describe('AuthService.register — cadastro curto', () => {
  it('grava CPF e telefone, cria a entrevista JA com as respostas e o marco de cadastro inicial (atomico), e avisa o Telegram', async () => {
    const { service, created, telegram } = build();
    const out = await service.register({ ...base, cpf: VALID_CPF, phone: '(11) 91234-5678' } as never);
    expect(out.tokens).toBeDefined();
    expect(created).toHaveLength(1);
    const data = created[0];
    expect(data).toMatchObject({ email: 'ana@example.com', name: 'Ana Souza', cpf: '52998224725', phone: '11912345678' });
    expect(data.onboardingInterview.create.answers).toEqual({ personal_name: 'Ana Souza', personal_phone: '11912345678', personal_cpf: '52998224725' });
    expect(data.onboardingInterview.create.quickIntakeCompletedAt).toBeInstanceOf(Date);
    const text = (telegram.notifyCoach.mock.calls as unknown as string[][])[0][0];
    expect(text).toContain('Aluno fez o cadastro, aguardando pagamento');
    expect(text).toContain('Ana Souza');
    expect(text).not.toContain('52998224725'); // o CPF nunca vai para o Telegram
  });

  it('fluxo antigo (sem CPF/telefone, aplicativos ja publicados): nada de entrevista pre-criada, sem aviso novo', async () => {
    const { service, created, telegram } = build();
    await service.register({ ...base } as never);
    expect(created[0].onboardingInterview).toBeUndefined();
    expect(created[0].cpf).toBeUndefined();
    expect(telegram.notifyCoach).not.toHaveBeenCalled();
  });

  it('recusa CPF invalido, telefone invalido e so um dos dois; nada e criado', async () => {
    const { service, created } = build();
    await expect(service.register({ ...base, cpf: '111.111.111-11', phone: '11912345678' } as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.register({ ...base, cpf: VALID_CPF, phone: '123' } as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.register({ ...base, cpf: VALID_CPF } as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.register({ ...base, phone: '11912345678' } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(created).toHaveLength(0);
  });

  it('CPF ja usado: mensagem clara (antes de criar e tambem se a corrida estourar a unicidade); e-mail repetido segue com a mensagem de e-mail', async () => {
    const taken = build({ cpfTaken: true });
    await expect(taken.service.register({ ...base, cpf: VALID_CPF, phone: '11912345678' } as never)).rejects.toThrow(/CPF ja esta cadastrado/);
    const race = build({ createError: new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: '5', meta: { target: ['cpf'] } }) });
    await expect(race.service.register({ ...base, cpf: VALID_CPF, phone: '11912345678' } as never)).rejects.toThrow(/CPF ja esta cadastrado/);
    const mailRace = build({ createError: new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: '5', meta: { target: ['email'] } }) });
    await expect(mailRace.service.register({ ...base, cpf: VALID_CPF, phone: '11912345678' } as never)).rejects.toThrow(/E-mail ja cadastrado/);
    const dup = build({ existingEmails: ['ana@example.com'] });
    await expect(dup.service.register({ ...base, cpf: VALID_CPF, phone: '11912345678' } as never)).rejects.toThrow(/E-mail ja cadastrado/);
  });

  it('falha do Telegram nao derruba o cadastro', async () => {
    const { service, telegram } = build();
    telegram.notifyCoach.mockRejectedValueOnce(new Error('fora do ar'));
    await expect(service.register({ ...base, cpf: VALID_CPF, phone: '11912345678' } as never)).resolves.toBeDefined();
  });
});
