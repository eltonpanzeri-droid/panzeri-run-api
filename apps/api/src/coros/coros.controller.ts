import { Body, Controller, Delete, Get, HttpCode, HttpException, Post, Query, Res, UseGuards } from '@nestjs/common';
import { requestZeppWorkoutSync } from '../zepp/zepp-workout-trigger';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { ProviderConnectionService } from '../provider-hub/provider-connection.service';
import { COROS_PROVIDER_ID } from './coros.connector';
import { CorosWorkoutPublisherService } from './coros-workout-publisher.service';
import { CorosSyncService } from './coros-sync.service';

interface HtmlResponse {
  status: (code: number) => HtmlResponse;
  type: (contentType: string) => HtmlResponse;
  setHeader: (name: string, value: string) => void;
  send: (html: string) => void;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));

// Rotas da COROS (30/10/2026): conexao, consentimento por grupo/finalidade, status, desconexao, exclusao, treinos no relogio e sincronizacao de atividades (consulta periodica; a COROS nao tem webhook fora da Partner API).
@Controller('coros')
export class CorosController {
  constructor(
    private readonly connections: ProviderConnectionService,
    private readonly config: ConfigService,
    private readonly workouts: CorosWorkoutPublisherService,
    private readonly sync: CorosSyncService,
  ) {}

  // Todas as rotas autenticadas usam SOMENTE o usuario do JWT; nenhum userId vem do cliente: a conta conectada e' sempre a do proprio usuario logado, nunca a de outro.
  // Abertas ao aluno (tela Dispositivos e integracoes > COROS), mas FAIL-CLOSED: so' funcionam para quem esta em COROS_ENABLED_USER_IDS (porta de habilitacao do conector).
  // O cliente envia o aceite expresso + grupos marcados + versao/hash do texto exibido ANTES de abrir a COROS; o servidor valida e registra. Nada vem pre-marcado nem e' presumido.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard('jwt'))
  @Post('connect')
  @HttpCode(200)
  connect(@CurrentUser() user: CurrentUserPayload, @Body() body: { groups?: unknown; purposes?: unknown; acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    return this.connections.begin(COROS_PROVIDER_ID, user.sub, { groups: body?.groups, purposes: body?.purposes ?? [], acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
  }

  // Concede/revoga finalidades opcionais (ex.: analise por IA externa) SEM reconectar. Revogar nao exige aceite; conceder exige o aceite sobre o texto vigente
  // e so' funciona quando o provedor esta liberado para a finalidade (hoje o envio externo de dados da COROS a IA esta BLOQUEADO).
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(AuthGuard('jwt'))
  @Post('purposes')
  @HttpCode(200)
  async purposes(@CurrentUser() user: CurrentUserPayload, @Body() body: { grant?: unknown; revoke?: unknown; acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    const result = await this.connections.updatePurposes(COROS_PROVIDER_ID, user.sub, { grant: body?.grant, revoke: body?.revoke, acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
    // Retirou o envio de treinos: o publicador encerra o acompanhamento agora e marca como 'retirada pendente' os treinos que ficaram no calendario da COROS (ela nao permite que o Panzeri Run os apague). Nunca desfaz a revogacao ja gravada.
    if (Array.isArray(body?.revoke) && body.revoke.includes('watch_delivery')) void this.workouts.reconcile(user.sub).catch(() => undefined);
    // Autorizou o envio de treinos: envia na hora (sem esperar a rotina de 30 minutos).
    if (Array.isArray(body?.grant) && body.grant.includes('watch_delivery')) requestZeppWorkoutSync(user.sub, 'grant');
    return result;
  }

  // Concede/revoga GRUPOS de dados (atividades, sensores, percurso GPS) depois de conectar. Revogar nao exige aceite e vale na hora; conceder exige o aceite sobre o texto vigente.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(AuthGuard('jwt'))
  @Post('groups')
  @HttpCode(200)
  groups(@CurrentUser() user: CurrentUserPayload, @Body() body: { grant?: unknown; revoke?: unknown; acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    return this.connections.updateGroups(COROS_PROVIDER_ID, user.sub, { grant: body?.grant, revoke: body?.revoke, acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
  }

  // Reconfirma o texto da conexao apos uma mudanca material (sem mudar o que o aluno ja autorizou).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard('jwt'))
  @Post('reconfirm')
  @HttpCode(200)
  reconfirm(@CurrentUser() user: CurrentUserPayload, @Body() body: { acknowledged?: unknown; consentVersion?: unknown; consentTextHash?: unknown }) {
    return this.connections.reconfirm(COROS_PROVIDER_ID, user.sub, { acknowledged: body?.acknowledged, version: body?.consentVersion, textHash: body?.consentTextHash });
  }

  // Painel "Privacidade e permissoes": estado de cada autorizacao (importacao, historico, envio de treinos, Atlas), versao/data, disponibilidade e o historico de decisoes.
  @UseGuards(AuthGuard('jwt'))
  @Get('permissions')
  permissions(@CurrentUser() user: CurrentUserPayload) {
    return this.connections.permissions(COROS_PROVIDER_ID, user.sub);
  }

  // Texto, grupos e finalidades que o cliente DEVE exibir antes de pedir a conexao (o pedido devolve versao + hash do que foi exibido).
  @UseGuards(AuthGuard('jwt'))
  @Get('consent')
  consent() {
    return this.connections.consentDocument(COROS_PROVIDER_ID);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('status')
  async status(@CurrentUser() user: CurrentUserPayload) {
    return { ...(await this.connections.status(COROS_PROVIDER_ID, user.sub)), availability: this.connections.availability(COROS_PROVIDER_ID, user.sub) };
  }

  // Para a coleta na hora e revoga a autorizacao na COROS. Nao apaga nada alem das credenciais; os treinos ja' no calendario da COROS permanecem (so' a aluna os apaga no app da COROS).
  @UseGuards(AuthGuard('jwt'))
  @Post('disconnect')
  @HttpCode(200)
  disconnect(@CurrentUser() user: CurrentUserPayload) {
    return this.connections.disconnect(COROS_PROVIDER_ID, user.sub);
  }

  // Excluir os dados importados da COROS do proprio aluno (exige estar desconectado).
  @UseGuards(AuthGuard('jwt'))
  @Delete('data')
  deleteData(@CurrentUser() user: CurrentUserPayload) {
    return this.connections.deleteData(COROS_PROVIDER_ID, user.sub);
  }

  // Treinos no relogio — estado e sincronizacao agora. Sempre do proprio usuario logado; o envio so' acontece com a finalidade `watch_delivery` concedida e `COROS_WORKOUT_PUBLISH_ENABLED=true`.
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

  // Atividades: importa agora (consulta a COROS e grava as novas). So' do proprio usuario; desligado ate COROS_SYNC_ENABLED=true; a COROS limita o download de arquivos a 50 por dia.
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @UseGuards(AuthGuard('jwt'))
  @Post('sync')
  @HttpCode(200)
  syncNow(@CurrentUser() user: CurrentUserPayload) {
    return this.sync.run(user.sub);
  }

  // A COROS redireciona o navegador para esta rota HTTPS publica (redirect registrado na COROS por registro dinamico de cliente).
  @Get('callback')
  async callback(@Query() query: { state?: unknown; code?: unknown; error?: unknown }, @Res() response: HtmlResponse) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    let status = 200;
    let title = 'COROS conectada';
    let message = 'A conta COROS foi vinculada. Pode voltar ao Panzeri Run.';
    try {
      const result = await this.connections.complete(COROS_PROVIDER_ID, query);
      if (result === 'cancelled') {
        title = 'Conexao cancelada';
        message = 'Nenhuma conta COROS foi vinculada. Pode voltar ao aplicativo.';
      }
    } catch (error) {
      status = error instanceof HttpException ? error.getStatus() : 502;
      title = 'Nao foi possivel conectar';
      message = status === 400
        ? 'A autorizacao e invalida, expirou ou ja foi utilizada. Inicie outra conexao no aplicativo.'
        : status === 409
          ? 'Esta conta COROS ja esta vinculada. Se for a sua, desconecte-a antes no aplicativo.'
          : status === 403
            ? 'Esta integracao esta indisponivel no momento.'
            : 'A conexao nao foi concluida. Inicie outra tentativa no aplicativo.';
    }
    // Nenhum state, code, token ou detalhe da resposta da COROS aparece no HTML.
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
