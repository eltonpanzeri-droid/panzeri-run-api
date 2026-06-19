import { BadRequestException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';

describe('AuthService', () => {
  it('rejects registration without LGPD and terms acceptance', async () => {
    const service = new AuthService({} as never, {} as never, {} as never);

    await expect(
      service.register({
        email: 'aluno@panzeri.run',
        password: '12345678',
        name: 'Aluno',
        acceptedTerms: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
