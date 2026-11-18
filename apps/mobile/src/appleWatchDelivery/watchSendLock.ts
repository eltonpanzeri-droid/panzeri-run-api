// Um envio ao Apple Watch por vez neste aparelho (18/11/2026): a geracao do treino e o efeito da lista de treinos disparam quase juntos e nao podem agendar o mesmo treino em paralelo.
// Pura, sem React Native, para ser testada.
let inFlight: Promise<unknown> = Promise.resolve();

export function withWatchSendLock<T>(task: () => Promise<T>): Promise<T> {
  const run = inFlight.then(task, task);
  inFlight = run.catch(() => undefined);
  return run;
}
