import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { TelegramService } from './billing/telegram.service';

@Controller()
export class AppController {
  constructor(private readonly telegram: TelegramService) {}

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
