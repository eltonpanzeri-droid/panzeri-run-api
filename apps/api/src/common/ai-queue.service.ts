import { Injectable, Logger } from '@nestjs/common';

// Limite de chamadas simultaneas a IA (Claude) em toda a aplicacao. Se muitos alunos pedirem
// treino/reavaliacao ao mesmo tempo, o excesso espera na fila em vez de disparar tudo de uma vez
// e sobrecarregar (ou levar rate limit da Anthropic, que faria o app cair para o motor
// deterministico com mais frequencia do que precisaria).
const MAX_CONCURRENT_AI_CALLS = 3;

@Injectable()
export class AiQueueService {
  private readonly logger = new Logger(AiQueueService.name);
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
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
