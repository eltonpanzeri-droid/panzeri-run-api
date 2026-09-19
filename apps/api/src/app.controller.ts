import { Body, Controller, Get, Headers, Param, Post, Res } from '@nestjs/common';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TelegramService } from './billing/telegram.service';
import { LANDING_PAGE_HTML } from './landing-page';
import { LINKS_PAGE_HTML } from './links-page';

@Controller()
export class AppController {
  constructor(private readonly telegram: TelegramService) {}

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

  @Get('legal/terms')
  terms(@Res() response: { type: (value: string) => { send: (value: string) => void } }) {
    response.type('html').send(legalPage('Termos de uso', [
      'O Panzeri Run fornece orientacoes de treino baseadas nas informacoes declaradas pelo aluno.',
      'O aluno deve interromper o treino em caso de dor, tontura, falta de ar anormal ou qualquer sintoma importante.',
      'O treinador pode ajustar, pausar ou cancelar o acesso conforme acompanhamento, seguranca e status do aluno.',
      'O uso do app nao substitui avaliacao medica, fisioterapeutica ou acompanhamento presencial quando necessario.',
    ]));
  }

  @Get('legal/privacy')
  privacy(@Res() response: { type: (value: string) => { send: (value: string) => void } }) {
    response.type('html').send(legalPage('Privacidade e LGPD', [
      'Coletamos dados de perfil, saude, disponibilidade, testes, treinos prescritos e treinos realizados.',
      'Esses dados sao usados para prescricao, acompanhamento, relatorios de evolucao e seguranca do treino.',
      'Dados de saude devem ser tratados com cuidado e acesso restrito ao treinador responsavel.',
      'O aluno pode solicitar revisao, correcao ou exclusao dos dados quando aplicavel.',
    ]));
  }
}

function legalPage(title: string, paragraphs: string[]) {
  return `
    <html>
      <head>
        <title>Panzeri Run - ${title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body { background: #f8fafc; color: #0f172a; font-family: Arial, sans-serif; margin: 0; padding: 24px; }
          main { background: #ffffff; border: 1px solid #dbe4ee; border-radius: 12px; margin: 32px auto; max-width: 720px; padding: 24px; }
          p { color: #334155; line-height: 1.6; }
        </style>
      </head>
      <body>
        <main>
          <h1>${title}</h1>
          ${paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('')}
        </main>
      </body>
    </html>
  `;
}
