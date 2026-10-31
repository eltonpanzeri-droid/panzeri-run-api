import { BadRequestException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';

// 30/10/2026: recuperacao de senha por CODIGO de 6 digitos enviado por e-mail. Antes (27/09) /auth/forgot-password devolvia o token ao app: qualquer pessoa que soubesse o e-mail
// de um aluno trocava a senha dele. Agora o servidor nunca devolve segredo e responde igual exista ou nao o e-mail.
describe('AuthService — recuperacao de senha por codigo', () => {
  type Code = { id: string; userId: string; codeHash: string; attempts: number; expiresAt: Date; usedAt: Date | null; createdAt: Date };
  function build(opts: { user?: { id: string; email: string; accountStatus: string } | null } = {}) {
    const user = opts.user === undefined ? { id: 'user-1', email: 'carol@example.com', accountStatus: 'active' } : opts.user;
    const codes: Code[] = [];
    let seq = 0;
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    const userUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user), update: userUpdate },
      passwordResetCode: {
        count: jest.fn(async ({ where }: { where: { userId: string; createdAt: { gt: Date } } }) => codes.filter((c) => c.userId === where.userId && c.createdAt > where.createdAt.gt).length),
        updateMany: jest.fn(async ({ where, data }: { where: { id?: string; userId?: string; usedAt: null }; data: { usedAt: Date } }) => {
          const hit = codes.filter((c) => (where.id ? c.id === where.id : c.userId === where.userId) && c.usedAt === null);
          hit.forEach((c) => { c.usedAt = data.usedAt; });
          return { count: hit.length };
        }),
        create: jest.fn(async ({ data }: { data: { userId: string; codeHash: string; expiresAt: Date } }) => {
          const row: Code = { id: 'c' + ++seq, attempts: 0, usedAt: null, createdAt: new Date(), ...data };
          codes.push(row);
          return row;
        }),
        findFirst: jest.fn(async ({ where }: { where: { userId: string } }) => [...codes].reverse().find((c) => c.userId === where.userId && c.usedAt === null) ?? null),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: { attempts: { increment: number } } }) => {
          const row = codes.find((c) => c.id === where.id)!;
          row.attempts += data.attempts.increment;
          return row;
        }),
      },
    };
    const email = { send: jest.fn(async (to: string, subject: string, text: string) => { sent.push({ to, subject, text }); return { ok: true }; }) };
    const service = new AuthService(prisma as never, {} as never, { get: jest.fn() } as never, {} as never, email as never);
    const lastCode = () => /: (\d{6})/.exec(sent[sent.length - 1]?.text ?? '')?.[1] as string;
    return { service, codes, sent, prisma, userUpdate, lastCode };
  }
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('e-mail cadastrado: NUNCA devolve token/codigo na resposta; o codigo vai so no e-mail', async () => {
    const { service, sent, lastCode } = build();
    const result = (await service.startPasswordReset('Carol@Example.com')) as Record<string, unknown>;
    await flush();
    expect(Object.keys(result).sort()).toEqual(['email', 'message']);
    expect(JSON.stringify(result)).not.toMatch(/\d{6}/);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('carol@example.com');
    expect(lastCode()).toMatch(/^\d{6}$/);
  });

  it('e-mail NAO cadastrado (ou conta excluida): mesma resposta, nada criado, nada enviado', async () => {
    const naoExiste = build({ user: null });
    const a = await naoExiste.service.startPasswordReset('naoexiste@example.com');
    const existe = build();
    const b = await existe.service.startPasswordReset('naoexiste@example.com');
    expect(a.message).toBe(b.message);
    expect(naoExiste.codes).toHaveLength(0);
    expect(naoExiste.sent).toHaveLength(0);
    const excluida = build({ user: { id: 'u', email: 'x@example.com', accountStatus: 'deleted' } });
    await excluida.service.startPasswordReset('x@example.com');
    expect(excluida.codes).toHaveLength(0);
  });

  it('codigo certo troca a senha, encerra sessoes, e nao pode ser reutilizado', async () => {
    const { service, userUpdate, lastCode, sent } = build();
    await service.startPasswordReset('carol@example.com');
    await flush();
    const code = lastCode();
    await expect(service.resetPasswordWithCode({ email: 'carol@example.com', code, password: 'novasenha123' })).resolves.toEqual({ message: 'Senha atualizada.' });
    expect(userUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' }, data: expect.objectContaining({ refreshTokenHash: null, passwordHash: expect.any(String) }) }));
    await flush();
    expect(sent[sent.length - 1].subject).toMatch(/senha foi alterada/);
    await expect(service.resetPasswordWithCode({ email: 'carol@example.com', code, password: 'outrasenha123' })).rejects.toBeInstanceOf(BadRequestException);
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });

  it('codigo errado: recusa e, apos 5 erros, ate o codigo certo e invalidado', async () => {
    const { service, userUpdate, lastCode } = build();
    await service.startPasswordReset('carol@example.com');
    await flush();
    const code = lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      await expect(service.resetPasswordWithCode({ email: 'carol@example.com', code: wrong, password: 'novasenha123' })).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(service.resetPasswordWithCode({ email: 'carol@example.com', code, password: 'novasenha123' })).rejects.toBeInstanceOf(BadRequestException);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('codigo expirado e recusado', async () => {
    const { service, codes, userUpdate, lastCode } = build();
    await service.startPasswordReset('carol@example.com');
    await flush();
    codes[0].expiresAt = new Date(Date.now() - 1000);
    await expect(service.resetPasswordWithCode({ email: 'carol@example.com', code: lastCode(), password: 'novasenha123' })).rejects.toBeInstanceOf(BadRequestException);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('pedido novo invalida o codigo anterior; no maximo 3 codigos por hora por conta', async () => {
    const { service, codes, sent, lastCode, userUpdate } = build();
    await service.startPasswordReset('carol@example.com');
    await flush();
    const first = lastCode();
    await service.startPasswordReset('carol@example.com');
    await flush();
    const second = lastCode();
    if (first !== second) {
      await expect(service.resetPasswordWithCode({ email: 'carol@example.com', code: first, password: 'novasenha123' })).rejects.toBeInstanceOf(BadRequestException);
    }
    await service.startPasswordReset('carol@example.com');
    await service.startPasswordReset('carol@example.com');
    await flush();
    expect(codes).toHaveLength(3);
    expect(sent).toHaveLength(3);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('dois envios simultaneos do mesmo codigo: so um troca a senha', async () => {
    const { service, userUpdate, lastCode } = build();
    await service.startPasswordReset('carol@example.com');
    await flush();
    const code = lastCode();
    const results = await Promise.allSettled([
      service.resetPasswordWithCode({ email: 'carol@example.com', code, password: 'novasenha123' }),
      service.resetPasswordWithCode({ email: 'carol@example.com', code, password: 'novasenha123' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService', () => {
  it('rejects registration without LGPD and terms acceptance', async () => {
    const service = new AuthService({} as never, {} as never, {} as never, {} as never);

    await expect(
      service.register({
        email: 'aluno@panzeri.run',
        password: '12345678',
        name: 'Aluno',
        acceptedTerms: false,
        acceptedExerciseResponsibility: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects registration without exercise responsibility acceptance', async () => {
    const service = new AuthService({} as never, {} as never, {} as never, {} as never);

    await expect(
      service.register({
        email: 'aluno@panzeri.run',
        password: '12345678',
        name: 'Aluno',
        acceptedTerms: true,
        acceptedExerciseResponsibility: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
