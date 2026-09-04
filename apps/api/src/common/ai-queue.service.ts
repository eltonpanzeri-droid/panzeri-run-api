import { Injectable, Logger } from '@nestjs/common';

// Limite de chamadas simultaneas a IA (Claude) em toda a aplicacao. Se muitos alunos pedirem
// treino/reavaliacao ao mesmo tempo, o excesso espera na fila em vez de disparar tudo de uma vez
// e sobrecarregar (ou levar rate limit da Anthropic, que faria o app cair para o motor
// deterministico com mais frequencia do que precisaria).
const MAX_CONCURRENT_AI_CALLS = 3;

// Rede de seguranca (incidente real 09/08 — aluna com o botao "Gerando..." parado, sem travamento
// visivel nos logs, mas sem nenhum limite de tempo protegendo a chamada tambem). Ate essa data,
// task() podia ficar pendurada pra sempre (rede instavel, chamada que nunca retorna) e a vaga
// nunca era liberada — travando 1 das 3 vagas da fila pra sempre, atrasando todo mundo depois.
// Esse teto NAO cancela a chamada de verdade na Anthropic (o SDK continua tentando em segundo
// plano), so desiste de esperar e libera a vaga pra fila andar, devolvendo erro pra quem chamou.
// Aumentado de 120s pra 300s em 18/08, depois de 300s pra 600s (10min) em 20/08 (ordem explicita
// do treinador, revendo a regra de 09/08) — incidente real: alunos com contexto mais pesado
// (varias diretivas, prova alvo, historico longo) estouravam o teto anterior com frequencia,
// perdendo a tentativa e queimando token a toa numa chamada que ia terminar de qualquer jeito (o
// SDK continua rodando nos bastidores mesmo apos o timeout local desistir — ver comentario acima).
// Esperar mais nao gasta mais token nenhum, so reduz o desperdicio de tentativas abandonadas cedo
// demais.
const TASK_TIMEOUT_MS = 600_000;

// 04/09: achado numa revisao pensando em escala (1000 assinantes) — o teto acima protege cada
// chamada JA EM ANDAMENTO, mas nao existia limite nenhum pro tempo de ESPERA na fila antes de
// comecar. Com so 3 vagas, um pico real de uso simultaneo (ex.: muita gente confirmando o
// check-in semanal ao mesmo tempo numa segunda de manha) podia deixar um pedido esperando vaga
// por muitos minutos, em silencio, sem nenhum erro claro pro aluno — so' um "Gerando..." parado.
// Isso NAO aumenta o numero de chamadas simultaneas (que depende do limite real da conta
// Anthropic, nao verificado aqui) — so' desiste de esperar e devolve erro claro depois de um
// tempo razoavel, em vez de deixar o aluno pendurado indefinidamente.
const QUEUE_WAIT_TIMEOUT_MS = 120_000;

@Injectable()
export class AiQueueService {
  private readonly logger = new Logger(AiQueueService.name);
  private active = 0;
  private readonly waiting: Array<{ resolve: () => void; timedOut: boolean }> = [];

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await this.withTimeout(task());
    } finally {
      this.release();
    }
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.logger.warn(`Chamada de IA excedeu ${TASK_TIMEOUT_MS / 1000}s — desistindo de esperar e liberando a vaga na fila.`);
        reject(new Error(`Chamada de IA excedeu o tempo limite de ${TASK_TIMEOUT_MS / 1000}s.`));
      }, TASK_TIMEOUT_MS);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });
  }

  private acquire(): Promise<void> {
    if (this.active < MAX_CONCURRENT_AI_CALLS) {
      this.active += 1;
      return Promise.resolve();
    }

    this.logger.log(`Fila de IA cheia (${this.active} em andamento) — aguardando vaga.`);
    return new Promise((resolve, reject) => {
      const entry = {
        resolve: () => {
          clearTimeout(timer);
          this.active += 1;
          resolve();
        },
        timedOut: false,
      };
      const timer = setTimeout(() => {
        entry.timedOut = true;
        this.logger.warn(`Chamada de IA esperou mais de ${QUEUE_WAIT_TIMEOUT_MS / 1000}s na fila — desistindo antes mesmo de comecar.`);
        reject(new Error('Sistema de IA sobrecarregado no momento. Tente novamente em alguns minutos.'));
      }, QUEUE_WAIT_TIMEOUT_MS);
      this.waiting.push(entry);
    });
  }

  private release() {
    this.active -= 1;
    // Pula entradas que ja desistiram por timeout (marcadas timedOut) — sem isso, a vaga liberada
    // iria pra alguem que ja recebeu erro e nao esta mais esperando, deixando o proximo da fila de
    // verdade esperando mais do que precisava.
    let next = this.waiting.shift();
    while (next?.timedOut) next = this.waiting.shift();
    if (next) next.resolve();
  }
}
