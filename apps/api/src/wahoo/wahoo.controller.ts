import { Controller, Get, HttpCode, HttpException, Post, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { WahooService } from './wahoo.service';

interface HtmlResponse {
  status: (code: number) => HtmlResponse;
  type: (contentType: string) => HtmlResponse;
  setHeader: (name: string, value: string) => void;
  send: (html: string) => void;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));

@Controller('wahoo')
export class WahooController {
  constructor(private readonly wahooService: WahooService) {}

  // Todas as rotas autenticadas usam SOMENTE o usuario do JWT; nenhum userId vem do cliente.
  @UseGuards(AuthGuard('jwt'))
  @Get('connect-url')
  connectUrl(@CurrentUser() user: CurrentUserPayload) {
    return this.wahooService.connectUrl(user.sub);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('status')
  status(@CurrentUser() user: CurrentUserPayload) {
    return this.wahooService.status(user.sub);
  }

  // Para a coleta/uso na hora e revoga a autorizacao na Wahoo. Nao apaga nada alem das credenciais.
  @UseGuards(AuthGuard('jwt'))
  @Post('disconnect')
  @HttpCode(200)
  disconnect(@CurrentUser() user: CurrentUserPayload) {
    return this.wahooService.disconnect(user.sub);
  }

  // A Wahoo redireciona o navegador diretamente para esta rota HTTPS publica (callback cadastrado no portal).
  @Get('callback')
  async callback(@Query() query: { state?: unknown; code?: unknown; error?: unknown }, @Res() response: HtmlResponse) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    let status = 200;
    let title = 'Wahoo conectada';
    let message = 'A conta Wahoo foi vinculada. Pode voltar ao Panzeri Run.';
    try {
      const result = await this.wahooService.callback(query);
      if (result === 'cancelled') {
        title = 'Conexao cancelada';
        message = 'Nenhuma conta Wahoo foi vinculada. Pode voltar ao aplicativo.';
      }
    } catch (error) {
      status = error instanceof HttpException ? error.getStatus() : 502;
      title = 'Nao foi possivel conectar';
      message = status === 400
        ? 'A autorizacao e invalida, expirou ou ja foi utilizada. Inicie outra conexao no aplicativo.'
        : status === 409
          ? 'Esta conta Wahoo ja esta vinculada a outro aluno.'
          : 'A conexao nao foi concluida. Inicie outra tentativa no aplicativo.';
    }
    // Nenhum state, code, token ou detalhe da resposta Wahoo aparece no HTML.
    const appUrl = this.wahooService.studentAppUrl();
    const link = appUrl ? `<p><a href="${escapeHtml(appUrl)}">Voltar ao aplicativo</a></p>` : '';
    const refresh = appUrl ? `<meta http-equiv="refresh" content="3;url=${escapeHtml(appUrl)}">` : '';
    response.status(status).type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh}<title>${title}</title><style>body{font:16px system-ui,sans-serif;margin:12vh auto;max-width:34rem;padding:1.5rem;color:#102341}h1{font-size:1.6rem}p{line-height:1.5}a{color:#246F91;font-weight:700}</style></head><body><h1>${title}</h1><p>${message}</p>${link}</body></html>`);
  }
}
