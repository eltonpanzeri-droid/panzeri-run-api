import { createRequire } from 'node:module';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { GARMIN_WEBHOOK_MAX_BYTES } from './garmin-activity';

// Os avisos de atividade da Garmin (activityDetails, ate 1 amostra por segundo) passam facilmente de 100 KB, o limite padrao do JSON: sem isto o servidor responde 413, a Garmin tenta de novo
// de hora em hora por 7 dias e depois DESCARTA o dado. Limite maior SO' nas rotas /garmin/webhook/ (todas as demais seguem com o limite padrao). A Garmin exige resposta 200 em ate 30 s: o
// processamento e' assincrono (fila).
// ATENCAO (aprendido no teste): NAO usar `app.useBodyParser('json', ...)`. O Nest considera o parser padrao "ja aplicado" pelo NOME da funcao e deixa de registra-lo: o corpo de TODAS as outras
// rotas (inclusive login) deixaria de ser lido. Aqui o parser da Garmin e' uma funcao com nome proprio, registrada ANTES do padrao; o body-parser ignora quem ja' foi lido.
export const isGarminWebhookJson = (request: { url?: string; headers?: Record<string, string | string[] | undefined> }): boolean =>
  (request.url ?? '').startsWith('/garmin/webhook/') && /json/i.test(String(request.headers?.['content-type'] ?? ''));

export function configureGarminWebhookBodyParser(app: NestExpressApplication): void {
  // body-parser e' dependencia do platform-express (nao do pacote da API): carrega pelo mesmo caminho que o Nest usa.
  const bodyParser = createRequire(require.resolve('@nestjs/platform-express'))('body-parser') as { json: (options: { limit: number; type: () => boolean }) => (req: unknown, res: unknown, next: (error?: unknown) => void) => void };
  const parse = bodyParser.json({ limit: GARMIN_WEBHOOK_MAX_BYTES, type: () => true });
  app.use(function garminWebhookJsonParser(req: { url?: string; headers?: Record<string, string | string[] | undefined> }, res: unknown, next: (error?: unknown) => void) {
    if (!isGarminWebhookJson(req)) return next();
    return parse(req, res, next);
  });
}
