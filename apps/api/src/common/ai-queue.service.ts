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
// Ordem explicita do treinador (09/08): esse limite de 120s e fixo — a chamada tem que ser rapida
// o suficiente pra caber nele, o teto nao deve ser esticado pra acomodar chamada lenta.
const TASK_TIMEOUT_MS = 120_000;

@Injectable()
export class AiQueueService {
  private readonly logger = new Logger(AiQueueService.name);
  private active = 0;
  private readonly waiting: Array<() => void> = [];

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
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release() {
    this.active -= 1;
    const next = this.waiting.shift();
    if (next) next();
  }
}
