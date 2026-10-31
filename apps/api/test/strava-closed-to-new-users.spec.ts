import { ForbiddenException } from '@nestjs/common';
import { StravaController } from '../src/strava/strava.controller';
import { StravaService } from '../src/strava/strava.service';

// Strava fechado para NOVOS alunos (30/10/2026, decisao de Elton). O fluxo OAuth e o callback nao mudam; so' a abertura da autorizacao e' recusada para quem nao tem conexao.
describe('Strava indisponivel para novos alunos', () => {
  const serviceWith = (connection: unknown) => {
    const service = Object.create(StravaService.prototype) as StravaService;
    (service as unknown as { prisma: unknown }).prisma = { stravaConnection: { findUnique: async () => connection } };
    return service;
  };

  it('sem conexao registrada: o servidor recusa (403) e nao abre a autorizacao; com conexao: segue como antes', async () => {
    await expect(serviceWith(null).assertOpenForUser('novo')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(serviceWith({ id: 'c1' }).assertOpenForUser('antigo')).resolves.toBeUndefined();
  });

  it('o endpoint connect-url checa ANTES de montar a URL (app antigo tambem e barrado)', async () => {
    const service = { assertOpenForUser: jest.fn(async () => { throw new ForbiddenException(); }), connectUrl: jest.fn() };
    const controller = new StravaController(service as never);
    await expect(controller.connectUrl({ sub: 'novo' } as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.connectUrl).not.toHaveBeenCalled();
    const open = { assertOpenForUser: jest.fn(async () => undefined), connectUrl: jest.fn(async () => ({ url: 'https://strava.example/auth' })) };
    expect(await new StravaController(open as never).connectUrl({ sub: 'antigo' } as never)).toEqual({ url: 'https://strava.example/auth' });
  });
});
