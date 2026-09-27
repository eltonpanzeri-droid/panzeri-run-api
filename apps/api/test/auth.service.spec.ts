import { BadRequestException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';

// 27/09/2026: recuperacao de senha 100% dentro do app (Carol pediu link pelo WhatsApp porque o
// fluxo antigo so mandava "peca ao treinador" — Resend sem dominio configurado, nenhum e-mail de
// fato saia). Agora /auth/forgot-password devolve o token cru pro app usar na hora, sem depender
// de e-mail nem do treinador gerar link manual.
describe('AuthService.startPasswordReset — token exposto pro app usar sem e-mail', () => {
  function build(userFound: { id: string; email: string } | null) {
    const passwordResetToken = { create: jest.fn().mockResolvedValue({}) };
    const user = { findUnique: jest.fn().mockResolvedValue(userFound) };
    const prisma = { user, passwordResetToken };
    const config = { get: jest.fn() };
    const service = new AuthService(prisma as never, {} as never, config as never, {} as never);
    return { service, passwordResetToken };
  }

  it('e-mail cadastrado: devolve token cru (o app usa na hora pra trocar a senha, sem link/e-mail)', async () => {
    const { service, passwordResetToken } = build({ id: 'user-1', email: 'carol@example.com' });
    const result = await service.startPasswordReset('carol@example.com');
    expect(typeof result.token).toBe('string');
    expect((result.token as string).length).toBeGreaterThan(20);
    expect(passwordResetToken.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-1' }),
    }));
  });

  it('e-mail NAO cadastrado: nunca revela isso — responde sem token e sem criar nada', async () => {
    const { service, passwordResetToken } = build(null);
    const result = await service.startPasswordReset('naoexiste@example.com');
    expect(result.token).toBeUndefined();
    expect(passwordResetToken.create).not.toHaveBeenCalled();
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
