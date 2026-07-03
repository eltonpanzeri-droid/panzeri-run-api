import { Controller, Get, Res } from '@nestjs/common';

@Controller()
export class AppController {
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
