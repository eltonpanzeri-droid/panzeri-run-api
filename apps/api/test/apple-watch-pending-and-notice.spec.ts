import { readFileSync } from 'fs';
import { join } from 'path';
import { AppleWatchDeliveryService } from '../src/workout-delivery/apple-watch-delivery.service';

// 16/11/2026 (caso Volnei): o envio de treinos ao Apple Watch so' acontece com o Panzeri Run aberto no iPhone. O aviso de programa novo lembra disso, o app mostra quantos treinos ainda
// nao estao no relogio e o painel do treinador mostra o estado do envio.

const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');

describe('upcomingStatus (aviso "N treinos ainda nao estao no seu Apple Watch")', () => {
  function build(sessionIds: string[], sentIds: string[]) {
    const prisma = {
      trainingSession: { findMany: jest.fn().mockResolvedValue(sessionIds.map((id) => ({ id }))) },
      workoutDelivery: { findMany: jest.fn().mockResolvedValue(sentIds.map((trainingSessionId) => ({ trainingSessionId }))) },
    };
    return { service: new AppleWatchDeliveryService(prisma as never, {} as never), prisma };
  }

  it('conta as corridas dos proximos 7 dias e quantas ja tem envio confirmado', async () => {
    const { service } = build(['a', 'b', 'c'], ['a']);
    expect(await service.upcomingStatus('u1')).toEqual({ upcoming: 3, sent: 1 });
  });

  it('so olha a propria aluna, corrida/esteira sem feedback do programa ativo, e so entregas confirmadas do Apple Watch', async () => {
    const { service, prisma } = build(['a'], []);
    await service.upcomingStatus('u1');
    const where = prisma.trainingSession.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 'u1', modality: { in: ['corrida', 'esteira'] }, completion: null, plan: { status: 'active' } });
    expect(prisma.workoutDelivery.findMany.mock.calls[0][0].where).toMatchObject({ provider: 'apple_workoutkit', status: { in: ['sent', 'delivered_to_device'] } });
  });

  it('sem treino nos proximos dias: nem consulta as entregas', async () => {
    const { service, prisma } = build([], []);
    expect(await service.upcomingStatus('u1')).toEqual({ upcoming: 0, sent: 0 });
    expect(prisma.workoutDelivery.findMany).not.toHaveBeenCalled();
  });
});

describe('ligacoes (estatico)', () => {
  it('a rota existe e e da propria conta (jwt)', () => {
    const controller = read('src', 'workout-delivery', 'apple-watch-delivery.controller.ts');
    expect(controller).toContain("@Get('upcoming-status')");
    expect(controller).toContain('this.service.upcomingStatus(user.sub)');
  });
  it('o aviso de programa novo lembra de abrir o Panzeri Run so para quem ja enviou treinos ao Apple Watch', () => {
    const plans = read('src', 'training-plans', 'training-plans.service.ts');
    expect(plans).toContain("provider: 'apple_workoutkit', status: { in: ['sent', 'delivered_to_device'] }, trainingSession: { userId } }");
    expect(readFileSync(join(__dirname, '..', 'src', 'training-plans', 'plan-generated-notice.ts'), 'utf8')).toContain('Confira se os treinos da semana chegaram ao seu Apple Watch');
  });
  it('o app mostra o aviso na tela da semana e o cartao usa a mesma sincronizacao', () => {
    const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
    expect(app).toContain('<AppleWatchPendingBanner accessToken={accessToken} apiUrl={API_URL} refreshKey={plan} />');
    const card = readFileSync(join(__dirname, '..', '..', 'mobile', 'src', 'appleWatchDelivery', 'AppleWatchWorkoutsCard.tsx'), 'utf8');
    expect(card).toContain('syncWeekToAppleWatch(call)');
  });
  it('o painel mostra o envio ao Apple Watch dentro da Apple Saude', () => {
    const service = read('src', 'coach', 'student-integrations.service.ts');
    expect(service).toContain("id: 'watch_delivery', label: 'Treinos enviados ao Apple Watch'");
    expect(service).toContain("provider: 'apple_workoutkit'");
  });
});
