import { Body, Controller, Get, Headers, Param, Post, Query, Redirect, Res } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LEGAL_PATHS, LEGAL_SUMMARY } from './legal/legal-content';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TelegramService } from './billing/telegram.service';
import { FunnelService } from './funnel/funnel.service';
import { LANDING_PAGE_HTML } from './landing-page';
import { LINKS_PAGE_HTML } from './links-page';

@Controller()
export class AppController {
  constructor(
    private readonly telegram: TelegramService,
    private readonly funnel: FunnelService,
  ) {}

  // The public landing stays in the API; app authentication and billing are unchanged.
  @Get()
  landingPage(@Res() response: { type: (value: string) => { send: (value: string) => void } }) {
    response.type('html').send(LANDING_PAGE_HTML);
  }

  // Gerador de Links Panzeri (UTM) — fonte canonica dos links rastreaveis. Estava fora do ar
  // desde 16/09 (commit 617788a apagou esta rota); restaurado em 19/09 sem nenhuma alteracao.
  @Get('links')
  linksPage(@Res() response: { type: (value: string) => { send: (value: string) => void } }) {
    response.type('html').send(LINKS_PAGE_HTML);
  }

  // Nem a Play Store nem a App Store avisam o Leo quando alguem clica num link externo — esse
  // endpoint e' a unica forma de contar esses cliques antes da pessoa sair do nosso dominio.
  // So conta o CLIQUE, nunca a instalacao (isso exigiria SDK de attribution de terceiro, tipo
  // Adjust/AppsFlyer — fora de escopo pro volume atual). sessionId e' gerado na hora: cada clique
  // e' uma visita nova, sem jornada anterior pra vincular (quem clica aqui esta saindo do site).
  private static readonly STORE_URLS: Record<string, string> = {
    play: 'https://play.google.com/store/apps/details?id=com.panzerirun.app',
    apple: 'https://apps.apple.com/br/app/panzeri-run/id6805618958',
  };

  @Get('ir/:destino')
  @Redirect()
  async storeRedirect(
    @Param('destino') destino: string,
    @Query('utm_source') source?: string,
    @Query('utm_medium') medium?: string,
    @Query('utm_campaign') campaign?: string,
    @Query('utm_content') content?: string,
  ) {
    const base = AppController.STORE_URLS[destino];
    if (!base) return { url: '/', statusCode: 302 };

    const utmPairs: [string, string][] = [];
    if (source) utmPairs.push(['utm_source', source.slice(0, 300)]);
    if (medium) utmPairs.push(['utm_medium', medium.slice(0, 300)]);
    if (campaign) utmPairs.push(['utm_campaign', campaign.slice(0, 300)]);
    if (content) utmPairs.push(['utm_content', content.slice(0, 300)]);

    // leo.service.ts (originOf) le source/medium/campaign/content SEM prefixo utm_ do metadata —
    // nomes diferentes aqui fariam a origem sair sempre vazia no Intelligence.
    await this.funnel.record({
      sessionId: randomUUID(),
      event: 'store_redirect_click',
      metadata: {
        destino,
        source: source?.slice(0, 300) ?? null,
        medium: medium?.slice(0, 300) ?? null,
        campaign: campaign?.slice(0, 300) ?? null,
        content: content?.slice(0, 300) ?? null,
      },
    });

    const url = new URL(base);
    if (destino === 'play') {
      // Play Install Referrer: a Play Store entrega esse valor pro app na instalacao, se o app ler.
      const referrer = utmPairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      if (referrer) url.searchParams.set('referrer', referrer);
    } else {
      // Apple ignora esses parametros (sem attribution nativa) — ficam so' de registro.
      utmPairs.forEach(([k, v]) => url.searchParams.set(k, v));
    }
    return { url: url.href, statusCode: 302 };
  }

  @Get('landing-assets/:filename')
  landingAsset(@Param('filename') filename: string, @Res() response: any) {
    // Fixed public asset set: never expose arbitrary files or originals outside this folder.
    if (
      filename !== 'elton.jpeg' &&
      filename !== 'panzeri-run-logo.png' &&
      !/^result-(0[1-9]|1[0-9]|2[01])\.jpeg$/.test(filename)
    ) {
      return response.status(404).send('Arquivo não encontrado');
    }
    const filePath = join(process.cwd(), 'public', 'landing', 'results', filename);
    if (!existsSync(filePath)) return response.status(404).send('Arquivo não encontrado');
    response.setHeader('Content-Type', filename.endsWith('.png') ? 'image/png' : 'image/jpeg');
    response.setHeader('Cache-Control', 'public, max-age=3600');
    return createReadStream(filePath).pipe(response);
  }

  @Get('media/:filename')
  landingMedia(
    @Param('filename') filename: string,
    @Headers('range') range: string | undefined,
    @Res() response: any,
  ) {
    const allowed: Record<string, string> = {
      'tela-treinos.mp4': 'tela-treinos.mp4',
      'evolucao-rotina.mp4': 'evolucao-rotina.mp4',
      'relatar-dor.mp4': 'relatar-dor.mp4',
    };
    const asset = allowed[filename];
    if (!asset) return response.status(404).send('Arquivo não encontrado');

    const filePath = join(process.cwd(), 'public', 'landing', asset);
    const fileSize = statSync(filePath).size;
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Content-Type', 'video/mp4');
    response.setHeader('Cache-Control', 'public, max-age=604800, immutable');

    if (!range) {
      response.setHeader('Content-Length', fileSize);
      return createReadStream(filePath).pipe(response);
    }

    const [startText, endText] = range.replace('bytes=', '').split('-');
    const start = Number(startText);
    const end = endText ? Number(endText) : Math.min(start + 1024 * 1024 - 1, fileSize - 1);
    if (!Number.isFinite(start) || start < 0 || end >= fileSize || start > end) {
      response.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      return response.end();
    }
    response.status(206);
    response.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    response.setHeader('Content-Length', end - start + 1);
    return createReadStream(filePath, { start, end }).pipe(response);
  }

  // Sem isso, uma tela travada no app do aluno (ex: durante a entrevista, o momento mais critico
  // pra conversao) simplesmente some sem ninguem saber — nem o treinador fica sabendo que
  // aconteceu, e muito menos em qual tela/erro exato. Ja custou pelo menos uma venda perdida.
  @Post('client-errors')
  async reportClientError(@Body() body: { message?: string; componentStack?: string; userEmail?: string }) {
    const message = String(body.message ?? 'Erro sem mensagem').slice(0, 500);
    const componentStack = String(body.componentStack ?? '').slice(0, 1000);
    const userEmail = body.userEmail ? String(body.userEmail).slice(0, 200) : 'nao identificado (aluno pode nao estar logado ainda)';
    await this.telegram.notifyCoach(
      `⚠️ O app do aluno travou (tela de erro exibida)\n\nAluno: ${userEmail}\nErro: ${message}\n\nOnde:\n${componentStack || 'sem detalhe de componente'}`,
    );
    return { received: true };
  }

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'panzeri-run-api',
      version: '2026.07.03-r7',
      planEngine: 'rules-v6',
    };
  }

  // 05/10/2026: duas versoes diferentes de Termos/Politica conviviam (estas e /termos-de-uso, /politica-privacidade).
  // Agora ha uma fonte unica (legal/legal-content.ts); as URLs antigas /legal/* so redirecionam para as canonicas.
  @Get('legal/terms')
  @Redirect(LEGAL_PATHS.terms, 301)
  terms() {
    return;
  }

  @Get('legal/privacy')
  @Redirect(LEGAL_PATHS.privacy, 301)
  privacy() {
    return;
  }

  // Resumo da tela "Privacidade e dados" do app: mesmas frases dos documentos publicos.
  @Get('legal/summary')
  legalSummary() {
    return LEGAL_SUMMARY;
  }
}
