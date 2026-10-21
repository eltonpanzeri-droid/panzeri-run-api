import { Body, Controller, Delete, Get, HttpCode, HttpException, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { ProviderConnectionService } from '../provider-hub/provider-connection.service';
import { ZEPP_PROVIDER_ID } from './zepp.connector';
import { ZeppWorkoutPublisherService } from './zepp-workout-publisher.service';

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
    private readonly workouts: ZeppWorkoutPublisherService,
  ) {}

  // Todas as rotas autenticadas usam SOMENTE o usuario do JWT; nenhum userId vem do cliente: a conta conectada e' sempre a do proprio usuario logado, nunca a de outro.
  // Abertas ao aluno (tela Configuracoes > Integracoes > Zepp/Amazfit), mas FAIL-CLOSED: so' funcionam para quem esta em ZEPP_ENABLED_USER_IDS (porta de habilitacao do conector).
  // O cliente envia o aceite expresso + grupos marcados + versao/hash do texto exibido ANTES de abrir a Zepp; o servidor valida e registra. Nada vem pre-marcado nem e' presumido.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard('jwt'))
  @Post('connect')
  @HttpCode(200)
  connect(@CurrentUser() user: CurrentUserPayload, @Body() body: { groups?: unknown; purposes?: unknown; acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    return this.connections.begin(ZEPP_PROVIDER_ID, user.sub, { groups: body?.groups, purposes: body?.purposes ?? [], acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
  }

  // Concede/revoga finalidades opcionais (ex.: analise por IA externa) SEM reconectar. Revogar nao exige aceite; conceder exige o aceite sobre o texto vigente
  // e so' funciona quando o provedor esta liberado para a finalidade (hoje o envio externo de dados da Zepp esta BLOQUEADO).
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(AuthGuard('jwt'))
  @Post('purposes')
  @HttpCode(200)
  async purposes(@CurrentUser() user: CurrentUserPayload, @Body() body: { grant?: unknown; revoke?: unknown; acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    const result = await this.connections.updatePurposes(ZEPP_PROVIDER_ID, user.sub, { grant: body?.grant, revoke: body?.revoke, acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
    // Retirou o envio de treinos: o publicador remove os treinos da conta Zepp agora (nao espera a rotina periodica). Nunca desfaz a revogacao ja gravada.
    if (Array.isArray(body?.revoke) && body.revoke.includes('watch_delivery')) void this.workouts.reconcile(user.sub).catch(() => undefined);
    return result;
  }

  // Concede/revoga GRUPOS de dados (atividades, sensores, percurso GPS) depois de conectar. Revogar nao exige aceite e vale na hora; conceder exige o aceite sobre o texto vigente.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(AuthGuard('jwt'))
  @Post('groups')
  @HttpCode(200)
  groups(@CurrentUser() user: CurrentUserPayload, @Body() body: { grant?: unknown; revoke?: unknown; acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    return this.connections.updateGroups(ZEPP_PROVIDER_ID, user.sub, { grant: body?.grant, revoke: body?.revoke, acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
  }

  // Reconfirma o texto da conexao apos uma mudanca material (sem mudar o que o aluno ja autorizou).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard('jwt'))
  @Post('reconfirm')
  @HttpCode(200)
  reconfirm(@CurrentUser() user: CurrentUserPayload, @Body() body: { acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    return this.connections.reconfirm(ZEPP_PROVIDER_ID, user.sub, { acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
  }

  // Painel "Privacidade e permissoes": estado de cada autorizacao (importacao, historico, envio de treinos, Atlas), versao/data, disponibilidade e o historico de decisoes.
  @UseGuards(AuthGuard('jwt'))
  @Get('permissions')
  permissions(@CurrentUser() user: CurrentUserPayload) {
    return this.connections.permissions(ZEPP_PROVIDER_ID, user.sub);
  }

  // Texto, grupos e finalidades que o cliente DEVE exibir antes de pedir a conexao (o pedido devolve versao + hash do que foi exibido).
  @UseGuards(AuthGuard('jwt'))
  @Get('consent')
  consent() {
    return this.connections.consentDocument(ZEPP_PROVIDER_ID);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('status')
  async status(@CurrentUser() user: CurrentUserPayload) {
    return { ...(await this.connections.status(ZEPP_PROVIDER_ID, user.sub)), availability: this.connections.availability(ZEPP_PROVIDER_ID, user.sub) };
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

  // Treinos no relogio (Lote 2) — estado, sincronizacao agora e retirada EXPLICITA. Sempre do proprio usuario logado; o envio so' acontece com a finalidade
  // `watch_delivery` concedida, `ZEPP_WORKOUT_PUBLISH_ENABLED=true` e o perfil de unidades da Workout V2 confirmado pela Zepp.
  @UseGuards(AuthGuard('jwt'))
  @Get('workouts/status')
  workoutsStatus(@CurrentUser() user: CurrentUserPayload) {
    return this.workouts.status(user.sub);
  }

  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @UseGuards(AuthGuard('jwt'))
  @Post('workouts/sync')
  @HttpCode(200)
  workoutsSync(@CurrentUser() user: CurrentUserPayload) {
    return this.workouts.reconcile(user.sub);
  }

  // Retira os treinos do relogio (envia a janela VAZIA, que apaga na Zepp). Unico caminho manual de lista vazia: exige confirmacao expressa no corpo.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @UseGuards(AuthGuard('jwt'))
  @Post('workouts/clear')
  @HttpCode(200)
  workoutsClear(@CurrentUser() user: CurrentUserPayload, @Body() body: { confirm?: unknown }) {
    if (body?.confirm !== true) throw new HttpException('Confirme a retirada dos treinos do relogio (confirm: true).', 400);
    return this.workouts.clearWindow(user.sub);
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
