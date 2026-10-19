import { Body, Controller, Delete, Get, HttpCode, HttpException, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { ProviderConnectionService } from '../provider-hub/provider-connection.service';
import { ZEPP_PROVIDER_ID } from './zepp.connector';

interface HtmlResponse {
  status: (code: number) => HtmlResponse;
  type: (contentType: string) => HtmlResponse;
  setHeader: (name: string, value: string) => void;
  send: (html: string) => void;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));

// Rotas da Zepp (Passo 2): conexao, status, desconexao e exclusao. NAO ha rota de sincronizacao nem de webhook (recebimento de dados ainda nao habilitado).
@Controller('zepp')
export class ZeppController {
  constructor(
    private readonly connections: ProviderConnectionService,
    private readonly config: ConfigService,
  ) {}

  // Todas as rotas autenticadas usam SOMENTE o usuario do JWT; nenhum userId vem do cliente.
  // O app envia o consentimento (categorias + versao do termo) ANTES de abrir a Zepp; fica registrado na conexao.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard('jwt'))
  @Post('connect')
  @HttpCode(200)
  connect(@CurrentUser() user: CurrentUserPayload, @Body() body: { categories?: unknown; consentVersion?: unknown }) {
    return this.connections.begin(ZEPP_PROVIDER_ID, user.sub, { categories: body?.categories, version: body?.consentVersion });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('status')
  status(@CurrentUser() user: CurrentUserPayload) {
    return this.connections.status(ZEPP_PROVIDER_ID, user.sub);
  }

  // Para a coleta na hora e revoga a autorizacao na Zepp. Nao apaga nada alem das credenciais.
  @UseGuards(AuthGuard('jwt'))
  @Post('disconnect')
  @HttpCode(200)
  disconnect(@CurrentUser() user: CurrentUserPayload) {
    return this.connections.disconnect(ZEPP_PROVIDER_ID, user.sub);
  }

  // Excluir os dados importados da Zepp do proprio aluno (exige estar desconectado).
  @UseGuards(AuthGuard('jwt'))
  @Delete('data')
  deleteData(@CurrentUser() user: CurrentUserPayload) {
    return this.connections.deleteData(ZEPP_PROVIDER_ID, user.sub);
  }

  // A Zepp redireciona o navegador para esta rota HTTPS publica (redirect cadastrado no console da Zepp).
  @Get('callback')
  async callback(@Query() query: { state?: unknown; code?: unknown; error?: unknown }, @Res() response: HtmlResponse) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    let status = 200;
    let title = 'Zepp conectada';
    let message = 'A conta Zepp foi vinculada. Pode voltar ao Panzeri Run.';
    try {
      const result = await this.connections.complete(ZEPP_PROVIDER_ID, query);
      if (result === 'cancelled') {
        title = 'Conexao cancelada';
        message = 'Nenhuma conta Zepp foi vinculada. Pode voltar ao aplicativo.';
      }
    } catch (error) {
      status = error instanceof HttpException ? error.getStatus() : 502;
      title = 'Nao foi possivel conectar';
      message = status === 400
        ? 'A autorizacao e invalida, expirou ou ja foi utilizada. Inicie outra conexao no aplicativo.'
        : status === 409
          ? 'Esta conta Zepp ja esta vinculada. Se for a sua, desconecte-a antes no aplicativo.'
          : status === 403
            ? 'Esta integracao esta indisponivel no momento.'
            : 'A conexao nao foi concluida. Inicie outra tentativa no aplicativo.';
    }
    // Nenhum state, code, token ou detalhe da resposta Zepp aparece no HTML.
    const appUrl = this.studentAppUrl();
    const link = appUrl ? `<p><a href="${escapeHtml(appUrl)}">Voltar ao aplicativo</a></p>` : '';
    const refresh = appUrl ? `<meta http-equiv="refresh" content="3;url=${escapeHtml(appUrl)}">` : '';
    response.status(status).type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh}<title>${title}</title><style>body{font:16px system-ui,sans-serif;margin:12vh auto;max-width:34rem;padding:1.5rem;color:#102341}h1{font-size:1.6rem}p{line-height:1.5}a{color:#246F91;font-weight:700}</style></head><body><h1>${title}</h1><p>${message}</p>${link}</body></html>`);
  }

  private studentAppUrl(): string | null {
    const configured = this.config.get<string>('STUDENT_APP_URL')?.trim();
    if (!configured) return null;
    try {
      const url = new URL(configured);
      return url.protocol === 'https:' ? url.toString() : null;
    } catch { return null; }
  }
}
