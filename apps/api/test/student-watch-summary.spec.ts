import { readFileSync } from 'fs';
import { join } from 'path';
import { buildWatchSummary, WATCH_PROVIDERS, type WatchSummaryRaw } from '../src/coach/student-watch-summary';
import { StudentIntegrationsService } from '../src/coach/student-integrations.service';

// 17/11/2026 (pedido de Elton, caso Volnei): resumo na tela Treino da semana, por integracao conectada, independente do relogio.
const D = (iso: string) => new Date(iso);
const raw = (over: Partial<WatchSummaryRaw> = {}): WatchSummaryRaw => ({ connected: [], received: {}, weekRuns: 4, deliveries: {}, ...over });

describe('texto por integracao', () => {
  it('Polar: nao recebe treino no relogio; diz quantos treinos ja devolveu ao Panzeri Run, com explicacao', () => {
    const result = buildWatchSummary(raw({ connected: ['polar'], received: { polar: { week: 2, total: 31, lastAt: D('2026-11-15T10:00:00Z') } } }));
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]).toMatchObject({ provider: 'polar', receivesWorkouts: false, sent: null, receivedWeek: 2, receivedTotal: 31 });
    expect(result.devices[0].text).toBe('Usa Polar: não recebe treino no relógio. Já enviou ao Panzeri Run 2 treinos nesta semana (31 no total, o último em 15/11).');
    expect(result.devices[0].explain).toContain('A Polar não aceita receber treino');
    expect(result.headline).toContain('Nenhuma das integrações conectadas recebe treino no relógio');
  });

  it('Apple Watch: quantos dos treinos de corrida da semana ja foram ao relogio, falhas e o que devolveu', () => {
    const result = buildWatchSummary(raw({
      connected: ['apple_health'], weekRuns: 4,
      received: { apple_health: { week: 1, total: 9, lastAt: D('2026-11-14T10:00:00Z') } },
      deliveries: { apple_workoutkit: { sentWeek: 1, lastSentAt: D('2026-11-16T12:00:00Z'), failures7d: 2 } },
    }));
    const [device] = result.devices;
    expect(device).toMatchObject({ receivesWorkouts: true, sent: 1, failures7d: 2 });
    expect(device.text).toContain('1 de 4 treinos de corrida da semana foram enviados ao relógio (último envio em 16/11)');
    expect(device.text).toContain('2 falhas de envio nos últimos 7 dias');
    expect(device.text).toContain('Já enviou ao Panzeri Run 1 treino nesta semana');
    expect(device.explain).toContain('iPhone');
    expect(result.headline).toBe('A aluna tem integração que recebe treino no relógio.');
  });

  it('semana sem corrida: nao fala em "0 de 0"', () => {
    const result = buildWatchSummary(raw({ connected: ['zepp'], weekRuns: 0 }));
    expect(result.devices[0].text).toContain('Não há treino de corrida nesta semana para enviar.');
    expect(result.devices[0].text).not.toContain('0 de 0');
  });

  it('nunca enviou nada ao Panzeri Run: diz isso, sem inventar zero de semana', () => {
    expect(buildWatchSummary(raw({ connected: ['garmin'] })).devices[0].text).toContain('Ainda não enviou nenhuma atividade ao Panzeri Run.');
  });

  it('varias integracoes (relogio + Health Connect): uma linha cada, na ordem fixa; sem integracao: texto proprio', () => {
    const result = buildWatchSummary(raw({ connected: ['health_connect', 'zepp', 'polar'] }));
    expect(result.devices.map((d) => d.provider)).toEqual(['polar', 'health_connect', 'zepp']);
    expect(buildWatchSummary(raw()).headline).toContain('Nenhuma integração conectada');
  });

  it('todo provedor tem explicacao e o envio so existe onde o servidor realmente envia', () => {
    for (const info of Object.values(WATCH_PROVIDERS)) expect(info.explain.length).toBeGreaterThan(40);
    expect(Object.entries(WATCH_PROVIDERS).filter(([, p]) => p.deliveryProvider).map(([id]) => id).sort()).toEqual(['apple_health', 'coros', 'garmin', 'zepp']);
  });
});

describe('servico watchSummary (leitura)', () => {
  function build() {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 's1' }) },
      trainingPlan: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', startDate: D('2026-11-16T00:00:00Z') }) },
      polarConnection: { findUnique: jest.fn().mockResolvedValue({ disconnectedAt: null }) },
      wahooConnection: { findUnique: jest.fn().mockResolvedValue(null) },
      stravaConnection: { findUnique: jest.fn().mockResolvedValue(null) },
      providerConnection: { findMany: jest.fn().mockResolvedValue([{ provider: 'apple_health', disconnectedAt: null }, { provider: 'zepp', disconnectedAt: D('2026-11-01T00:00:00Z') }]) },
      activityLog: { groupBy: jest.fn().mockResolvedValueOnce([{ provider: 'polar', _count: { _all: 5 }, _max: { startedAt: D('2026-11-15T10:00:00Z') } }]).mockResolvedValueOnce([{ provider: 'polar', _count: { _all: 1 } }]) },
      trainingSession: { count: jest.fn().mockResolvedValue(3) },
      workoutDelivery: { groupBy: jest.fn().mockResolvedValueOnce([{ provider: 'apple_workoutkit', _count: { _all: 2 }, _max: { requestedAt: D('2026-11-16T12:00:00Z') } }]).mockResolvedValueOnce([]) },
    };
    return { service: new StudentIntegrationsService(prisma as never, {} as never), prisma };
  }

  it('junta conexoes ativas, atividades devolvidas e envios do programa ativo; integracao desconectada nao aparece', async () => {
    const { service } = build();
    const result = await service.watchSummary('s1');
    expect(result.weekRuns).toBe(3);
    expect(result.devices.map((d) => d.provider)).toEqual(['polar', 'apple_health']);
    expect(result.devices[0]).toMatchObject({ receivesWorkouts: false, receivedWeek: 1, receivedTotal: 5 });
    expect(result.devices[1]).toMatchObject({ receivesWorkouts: true, sent: 2 });
  });

  it('so le o aluno pedido (programa ativo, corrida/esteira) e nunca tokens', async () => {
    const { service, prisma } = build();
    await service.watchSummary('s1');
    expect(prisma.trainingPlan.findFirst.mock.calls[0][0].where).toEqual({ userId: 's1', status: 'active' });
    expect(prisma.trainingSession.count.mock.calls[0][0].where).toMatchObject({ planId: 'p1', modality: { in: ['corrida', 'esteira'] } });
    for (const call of [...prisma.polarConnection.findUnique.mock.calls, ...prisma.providerConnection.findMany.mock.calls]) {
      expect(JSON.stringify(call[0])).not.toMatch(/token|secret|refresh/i);
    }
  });

  it('aluno inexistente: 404', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.watchSummary('x')).rejects.toThrow('Aluno nao encontrado.');
  });
});

describe('ligacoes (estatico)', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');
  it('rota e tela do painel', () => {
    expect(read('src', 'coach', 'coach.controller.ts')).toContain("@Get('students/:studentId/watch-summary')");
    const page = read('..', 'admin', 'app', 'page.tsx');
    expect(page).toContain('<WatchSummary studentId={student.id} accessToken={token} apiUrl={API_URL} />');
    expect(page.indexOf('<WatchSummary ')).toBeGreaterThan(page.indexOf("detailTab === 'treinos'"));
  });
});

describe('Relogio Wear OS no resumo do painel (17/11/2026)', () => {
  it('aparece como integracao conectada que usa o aplicativo do relogio, com o que devolveu ao Panzeri Run', () => {
    const result = buildWatchSummary({ connected: ['wear_os'], received: { wear_os: { week: 2, total: 5, lastAt: new Date('2026-11-17T10:00:00Z') } }, weekRuns: 4, deliveries: {} });
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]).toMatchObject({ provider: 'wear_os', receivesWorkouts: false, receivedWeek: 2, receivedTotal: 5 });
    expect(result.devices[0].text).toContain('Usa Relógio Wear OS');
    expect(result.devices[0].text).toContain('Já enviou ao Panzeri Run 2 treinos nesta semana (5 no total, o último em 17/11)');
    expect(result.devices[0].explain).toContain('Não depende do Health Connect');
  });
});
