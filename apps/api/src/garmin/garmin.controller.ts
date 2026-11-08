import { Body, Controller, Delete, Get, HttpCode, HttpException, NotFoundException, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import { createHash, timingSafeEqual } from 'node:crypto';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { ProviderConnectionService } from '../provider-hub/provider-connection.service';
import { GARMIN_PROVIDER_ID } from './garmin.connector';

interface HtmlResponse {
  status: (code: number) => HtmlResponse;
  type: (contentType: string) => HtmlResponse;
  setHeader: (name: string, value: string) => void;
  send: (html: string) => void;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));
const digest = (value: string) => createHash('sha256').update(value).digest();
const MAX_DEREGISTRATIONS_PER_CALL = 500;

// Rotas da Garmin (08/11/2026) — LOTE 1: conexao, consentimento por grupo/finalidade, status, desconexao, exclusao e o aviso de desregistro. Mesmo desenho da COROS (ProviderConnectionService faz state de
// uso unico, consentimento, cifra, renovacao e auditoria). Todas as rotas autenticadas usam SOMENTE o usuario do JWT. FAIL-CLOSED: so' funcionam para quem esta em GARMIN_ENABLED_USER_IDS.
@Controller('garmin')
export class GarminController {
  constructor(
    private readonly connections: ProviderConnectionService,
    private readonly config: ConfigService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard('jwt'))
  @Post('connect')
  @HttpCode(200)
  connect(@CurrentUser() user: CurrentUserPayload, @Body() body: { groups?: unknown; purposes?: unknown; acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    return this.connections.begin(GARMIN_PROVIDER_ID, user.sub, { groups: body?.groups, purposes: body?.purposes ?? [], acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
  }

  // Concede/revoga finalidades opcionais (envio de treinos, analise por IA externa) SEM reconectar. Revogar nao exige aceite; conceder exige o aceite sobre o texto vigente.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(AuthGuard('jwt'))
  @Post('purposes')
  @HttpCode(200)
  purposes(@CurrentUser() user: CurrentUserPayload, @Body() body: { grant?: unknown; revoke?: unknown; acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    return this.connections.updatePurposes(GARMIN_PROVIDER_ID, user.sub, { grant: body?.grant, revoke: body?.revoke, acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
  }

  // Concede/revoga GRUPOS de dados depois de conectar. Revogar nao exige aceite e vale na hora; conceder exige o aceite sobre o texto vigente.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(AuthGuard('jwt'))
  @Post('groups')
  @HttpCode(200)
  groups(@CurrentUser() user: CurrentUserPayload, @Body() body: { grant?: unknown; revoke?: unknown; acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    return this.connections.updateGroups(GARMIN_PROVIDER_ID, user.sub, { grant: body?.grant, revoke: body?.revoke, acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard('jwt'))
  @Post('reconfirm')
  @HttpCode(200)
  reconfirm(@CurrentUser() user: CurrentUserPayload, @Body() body: { acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    return this.connections.reconfirm(GARMIN_PROVIDER_ID, user.sub, { acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('permissions')
  permissions(@CurrentUser() user: CurrentUserPayload) {
    return this.connections.permissions(GARMIN_PROVIDER_ID, user.sub);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('consent')
  consent() {
    return this.connections.consentDocument(GARMIN_PROVIDER_ID);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('status')
  async status(@CurrentUser() user: CurrentUserPayload) {
    return { ...(await this.connections.status(GARMIN_PROVIDER_ID, user.sub)), availability: this.connections.availability(GARMIN_PROVIDER_ID, user.sub) };
  }

  // Para a coleta na hora e AVISA a Garmin (DELETE /user/registration, obrigatorio). Nao apaga nada alem das credenciais.
  @UseGuards(AuthGuard('jwt'))
  @Post('disconnect')
  @HttpCode(200)
  disconnect(@CurrentUser() user: CurrentUserPayload) {
    return this.connections.disconnect(GARMIN_PROVIDER_ID, user.sub);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('data')
  deleteData(@CurrentUser() user: CurrentUserPayload) {
    return this.connections.deleteData(GARMIN_PROVIDER_ID, user.sub);
  }

  // A Garmin redireciona o navegador para esta rota HTTPS publica (redirect cadastrado no portal da Garmin).
  @Get('callback')
  async callback(@Query() query: { state?: unknown; code?: unknown; error?: unknown }, @Res() response: HtmlResponse) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    let status = 200;
    let title = 'Garmin conectada';
    let message = 'A conta Garmin foi vinculada. Pode voltar ao Panzeri Run.';
    try {
      const result = await this.connections.complete(GARMIN_PROVIDER_ID, query);
      if (result === 'cancelled') {
        title = 'Conexao cancelada';
        message = 'Nenhuma conta Garmin foi vinculada. Pode voltar ao aplicativo.';
      }
    } catch (error) {
      status = error instanceof HttpException ? error.getStatus() : 502;
      title = 'Nao foi possivel conectar';
      message = status === 400
        ? 'A autorizacao e invalida, expirou ou ja foi utilizada. Inicie outra conexao no aplicativo.'
        : status === 409
          ? 'Esta conta Garmin ja esta vinculada. Se for a sua, desconecte-a antes no aplicativo.'
          : status === 403
            ? 'Esta integracao esta indisponivel no momento.'
            : 'A conexao nao foi concluida. Inicie outra tentativa no aplicativo.';
    }
    // Nenhum state, code, token ou detalhe da resposta da Garmin aparece no HTML.
    const appUrl = this.studentAppUrl();
    const link = appUrl ? `<p><a href="${escapeHtml(appUrl)}">Voltar ao aplicativo</a></p>` : '';
    const refresh = appUrl ? `<meta http-equiv="refresh" content="3;url=${escapeHtml(appUrl)}">` : '';
    response.status(status).type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh}<title>${title}</title><style>body{font:16px system-ui,sans-serif;margin:12vh auto;max-width:34rem;padding:1.5rem;color:#102341}h1{font-size:1.6rem}p{line-height:1.5}a{color:#246F91;font-weight:700}</style></head><body><h1>${title}</h1><p>${message}</p>${link}</body></html>`);
  }

  // Aviso de DESREGISTRO (a aluna se desconectou pela Garmin, ou nos chamamos DELETE /user/registration). A Garmin NAO assina os avisos: a prova de origem e' a chave secreta no endereco
  // (GARMIN_WEBHOOK_KEY, minimo 32 caracteres; sem ela a rota nao existe = fail-closed). Cadastre este endereco no portal da Garmin (API Tools) para "Deregistrations". Encerra a conexao local.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Post('webhook/:key/deregistrations')
  @HttpCode(200)
  async deregistrations(@Param('key') key: string, @Body() body: { deregistrations?: unknown }) {
    this.assertWebhookKey(key);
    const list = Array.isArray(body?.deregistrations) ? body.deregistrations.slice(0, MAX_DEREGISTRATIONS_PER_CALL) : [];
    let closed = 0;
    for (const item of list) {
      const userId = (item as { userId?: unknown } | null)?.userId;
      if (typeof userId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(userId)) continue;
      if ((await this.connections.handleRemoteRevocation(GARMIN_PROVIDER_ID, userId)) === 'closed') closed += 1;
    }
    return { ok: true, closed };
  }

  private assertWebhookKey(given: string): void {
    const configured = this.config.get<string>('GARMIN_WEBHOOK_KEY')?.trim();
    // Rota inexistente (404) quando nao configurada ou fraca: nao revela que existe.
    if (!configured || configured.length < 32) throw new NotFoundException();
    if (!timingSafeEqual(digest(given ?? ''), digest(configured))) throw new NotFoundException();
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
