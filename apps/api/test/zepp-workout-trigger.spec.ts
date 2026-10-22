import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_OPEN_MIN_INTERVAL_MS, ZeppWorkoutSchedulerService } from '../src/zepp/zepp-workout-scheduler.service';
import { requestZeppWorkoutSync, setZeppWorkoutTriggerHandler } from '../src/zepp/zepp-workout-trigger';

// Gatilhos imediatos de envio de treinos a Zepp (22/10/2026): ao autorizar, ao gerar/editar treino e ao abrir o app; a rotina de 30 minutos segue como rede de seguranca.

function setup(opts: { enabled?: boolean; allowed?: boolean } = {}) {
  const reconcile = jest.fn(async () => ({ status: 'published' }));
  const publisher = { isPublishingEnabled: () => opts.enabled ?? true, reconcile } as never;
  const isAllowed = jest.fn(async () => opts.allowed ?? true);
  const consent = { isAllowed } as never;
  const scheduler = new ZeppWorkoutSchedulerService({} as never, publisher, consent);
  scheduler.onModuleInit();
  return { scheduler, reconcile, isAllowed };
}

describe('gatilhos imediatos de envio de treinos a Zepp', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.useRealTimers(); setZeppWorkoutTriggerHandler(null); });

  it('ao AUTORIZAR: publica quase na hora (sem esperar a rotina de 30 minutos), so para quem tem a autorizacao', async () => {
    const { reconcile } = setup();
    requestZeppWorkoutSync('u1', 'grant');
    await jest.advanceTimersByTimeAsync(600);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith('u1');
  });

  it('aluna SEM a autorizacao de envio (ou sem conexao): nada e publicado', async () => {
    const { reconcile, isAllowed } = setup({ allowed: false });
    requestZeppWorkoutSync('u2', 'plan_generated');
    await jest.advanceTimersByTimeAsync(6000);
    expect(isAllowed).toHaveBeenCalledWith('zepp', 'u2', 'profile', 'watch_delivery');
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('treino gerado/editado: espera 5 s e AGRUPA varias edicoes seguidas numa sincronizacao so', async () => {
    const { reconcile } = setup();
    for (const reason of ['plan_generated', 'session_edited', 'session_removed', 'session_regenerated'] as const) requestZeppWorkoutSync('u1', reason);
    await jest.advanceTimersByTimeAsync(4000);
    expect(reconcile).not.toHaveBeenCalled(); // ainda dentro do atraso (a gravacao pode estar terminando)
    await jest.advanceTimersByTimeAsync(2000);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('um pedido que chega DEPOIS da execucao agenda outra (nada se perde)', async () => {
    const { reconcile } = setup();
    requestZeppWorkoutSync('u1', 'plan_generated');
    await jest.advanceTimersByTimeAsync(6000);
    requestZeppWorkoutSync('u1', 'session_edited');
    await jest.advanceTimersByTimeAsync(6000);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('abrir o app: no maximo uma conferencia a cada 5 minutos por aluna; outra aluna nao e afetada', async () => {
    const { reconcile } = setup();
    requestZeppWorkoutSync('u1', 'app_open');
    await jest.advanceTimersByTimeAsync(10);
    requestZeppWorkoutSync('u1', 'app_open');
    requestZeppWorkoutSync('u2', 'app_open');
    await jest.advanceTimersByTimeAsync(10);
    expect(reconcile.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['u1', 'u2']);
    await jest.advanceTimersByTimeAsync(APP_OPEN_MIN_INTERVAL_MS + 1000);
    requestZeppWorkoutSync('u1', 'app_open');
    await jest.advanceTimersByTimeAsync(10);
    expect(reconcile).toHaveBeenCalledTimes(3);
  });

  it('publicador desligado (ZEPP_WORKOUT_PUBLISH_ENABLED): nenhum gatilho faz nada', async () => {
    const { reconcile, isAllowed } = setup({ enabled: false });
    requestZeppWorkoutSync('u1', 'grant');
    await jest.advanceTimersByTimeAsync(10_000);
    expect(isAllowed).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('falha ao publicar nunca vira erro para quem pediu (disparo-e-esquece)', async () => {
    const { scheduler, reconcile } = setup();
    reconcile.mockRejectedValueOnce(new Error('zepp fora do ar'));
    expect(() => requestZeppWorkoutSync('u1', 'grant')).not.toThrow();
    await jest.advanceTimersByTimeAsync(600);
    expect(reconcile).toHaveBeenCalledTimes(1);
    requestZeppWorkoutSync('u1', 'grant'); // o proximo pedido volta a funcionar
    await jest.advanceTimersByTimeAsync(600);
    expect(reconcile).toHaveBeenCalledTimes(2);
    void scheduler;
  });
});

describe('os gatilhos estao ligados nos pontos certos (depois de gravar) e a rotina de 30 minutos permanece', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

  it('autorizacao, geracao semanal, regeneracao, reagendamento, edicao/remocao do treinador e abertura do app', () => {
    expect(read('zepp/zepp.controller.ts')).toContain("requestZeppWorkoutSync(user.sub, 'grant')");
    const plans = read('training-plans/training-plans.service.ts');
    expect(plans).toContain("requestZeppWorkoutSync(userId, 'plan_generated')");
    expect(plans).toContain("requestZeppWorkoutSync(userId, 'session_regenerated')");
    expect(plans).toContain("requestZeppWorkoutSync(session.userId, 'session_rescheduled')");
    const coach = read('coach/coach.service.ts');
    expect(coach).toContain("requestZeppWorkoutSync(studentId, 'session_edited')");
    expect(coach).toContain("requestZeppWorkoutSync(studentId, 'session_removed')");
    expect(read('training-plans/training-plans.controller.ts')).toContain("requestZeppWorkoutSync(user.sub, 'app_open')");
    expect(read('zepp/zepp-workout-scheduler.service.ts')).toContain('@Cron(CronExpression.EVERY_30_MINUTES)');
  });

  it('o pedido e feito DEPOIS da gravacao e nunca e aguardado (sem await): nao trava a geracao nem o painel', () => {
    for (const [file, ...needles] of [['training-plans/training-plans.service.ts', "requestZeppWorkoutSync(userId, 'plan_generated');", "requestZeppWorkoutSync(userId, 'session_regenerated');"], ['coach/coach.service.ts', "requestZeppWorkoutSync(studentId, 'session_edited');"]] as string[][]) {
      const source = read(file);
      for (const needle of needles) { expect(source).toContain(needle); expect(source).not.toContain(`await ${needle.replace(';', '')}`); }
    }
  });
});

describe('cartao "Treinos no relogio" da Zepp no app (22/10/2026)', () => {
  const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'src', 'zepp', 'ZeppIntegration.tsx'), 'utf8');
  const publisher = readFileSync(join(__dirname, '..', 'src', 'zepp', 'zepp-workout-publisher.service.ts'), 'utf8');

  it('tem o botao "Sincronizar agora" ligado a rota que ja existia, mostra o ultimo envio e o motivo quando nao ha treino, e so usa o estado do proprio usuario', () => {
    expect(app).toContain('function WatchWorkoutsCard');
    expect(app).toContain("label=\"Sincronizar agora\"");
    expect(app).toContain('/zepp/workouts/sync');
    expect(app).toContain('/zepp/workouts/status');
    expect(app).toContain('Último envio:');
    expect(app).toContain('não há treino de corrida programado para enviar agora');
    expect(app).toContain('<WatchWorkoutsCard accessToken={accessToken} apiUrl={apiUrl} grantedAt={watch.grantedAt} />');
    expect(app.toLowerCase()).toContain('sincronize o relógio no app da zepp'); // aceite da Zepp nao confirma que o relogio recebeu
  });

  it('o estado devolve o instante do ultimo aceite da Zepp (nulo se nada foi aceito)', () => {
    expect(publisher).toContain('lastAcceptedAt: acceptedStamps.length > 0');
    expect(publisher).toContain('windowAcceptedAt');
  });
});
