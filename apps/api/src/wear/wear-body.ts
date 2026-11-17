import { createRequire } from 'node:module';
import type { NestExpressApplication } from '@nestjs/platform-express';

// Um treino do relogio com um ponto por segundo passa de 100 KB (limite padrao do JSON) em corridas de cerca de 15 minutos: sem isto o servidor responderia 413 e o relogio nunca conseguiria
// enviar. Limite maior SO' em POST /wear/activities (todas as demais rotas seguem com o limite padrao). Mesmo cuidado da Garmin: NAO usar `app.useBodyParser('json', ...)`; funcao com nome proprio,
// registrada ANTES do parser padrao; o body-parser ignora quem ja' foi lido.
export const WEAR_ACTIVITY_MAX_BYTES = 3 * 1024 * 1024;

export const isWearActivityJson = (request: { url?: string; method?: string; headers?: Record<string, string | string[] | undefined> }): boolean =>
  request.method === 'POST' && (request.url ?? '').split('?')[0] === '/wear/activities' && /json/i.test(String(request.headers?.['content-type'] ?? ''));

export function configureWearActivityBodyParser(app: NestExpressApplication): void {
  const bodyParser = createRequire(require.resolve('@nestjs/platform-express'))('body-parser') as { json: (options: { limit: number; type: () => boolean }) => (req: unknown, res: unknown, next: (error?: unknown) => void) => void };
  const parse = bodyParser.json({ limit: WEAR_ACTIVITY_MAX_BYTES, type: () => true });
  app.use(function wearActivityJsonParser(req: { url?: string; method?: string; headers?: Record<string, string | string[] | undefined> }, res: unknown, next: (error?: unknown) => void) {
    if (!isWearActivityJson(req)) return next();
    return parse(req, res, next);
  });
}
