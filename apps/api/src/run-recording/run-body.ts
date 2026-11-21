import { createRequire } from 'node:module';
import type { NestExpressApplication } from '@nestjs/platform-express';

// Um treino gravado com um ponto por segundo passa de 100 KB (limite padrao do JSON) em corridas de cerca de 15 minutos: sem isto o servidor responderia 413 e o aplicativo nunca conseguiria enviar. Limite
// maior SO' em POST /me/run/activities (todas as demais rotas seguem com o limite padrao). Mesmo cuidado do Wear OS e da Garmin: NAO usar `app.useBodyParser('json', ...)`; funcao com nome proprio,
// registrada ANTES do parser padrao; o body-parser ignora quem ja' foi lido.
export const RUN_ACTIVITY_MAX_BYTES = 4 * 1024 * 1024;

export const isRunActivityJson = (request: { url?: string; method?: string; headers?: Record<string, string | string[] | undefined> }): boolean =>
  request.method === 'POST' && (request.url ?? '').split('?')[0] === '/me/run/activities' && /json/i.test(String(request.headers?.['content-type'] ?? ''));

export function configureRunActivityBodyParser(app: NestExpressApplication): void {
  const bodyParser = createRequire(require.resolve('@nestjs/platform-express'))('body-parser') as { json: (options: { limit: number; type: () => boolean }) => (req: unknown, res: unknown, next: (error?: unknown) => void) => void };
  const parse = bodyParser.json({ limit: RUN_ACTIVITY_MAX_BYTES, type: () => true });
  app.use(function runActivityJsonParser(req: { url?: string; method?: string; headers?: Record<string, string | string[] | undefined> }, res: unknown, next: (error?: unknown) => void) {
    if (!isRunActivityJson(req)) return next();
    return parse(req, res, next);
  });
}
