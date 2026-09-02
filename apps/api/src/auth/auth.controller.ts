import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('auth/refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  // Troca do "link magico" dos e-mails de aquecimento por uma sessao de verdade. So POST de
  // proposito (nunca GET) — ver comentario em AuthService.exchangeLoginLink sobre scanners de
  // e-mail que pre-visitam links e gastariam um token de uso unico sem o usuario ter clicado.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auth/login-link/exchange')
  exchangeLoginLink(@Body('token') token: string) {
    return this.authService.exchangeLoginLink(token);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/forgot-password')
  forgotPassword(@Body('email') email: string) {
    return this.authService.startPasswordReset(email);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('reset-password')
  resetPasswordPage(@Query('token') token: string, @Res() response: { type: (value: string) => { send: (value: string) => void } }) {
    response.type('html').send(`
      <html>
        <head>
          <title>Panzeri Run - criar senha</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            body { background: #f8fafc; color: #0f172a; font-family: Arial, sans-serif; margin: 0; padding: 24px; }
            main { background: #ffffff; border: 1px solid #dbe4ee; border-radius: 12px; margin: 48px auto; max-width: 420px; padding: 24px; }
            label, input, button { display: block; width: 100%; }
            input { border: 1px solid #cbd5e1; border-radius: 8px; box-sizing: border-box; margin: 8px 0 16px; padding: 12px; }
            button { background: #0f766e; border: 0; border-radius: 8px; color: white; cursor: pointer; font-weight: 700; padding: 12px; }
            .secondary { background: #ffffff; border: 1px solid #0f766e; color: #0f766e; margin: -4px 0 16px; }
            p { color: #475569; }
          </style>
        </head>
        <body>
          <main>
            <h1>Criar nova senha</h1>
            <p>Digite uma senha com pelo menos 8 caracteres.</p>
            <label>Nova senha</label>
            <input id="password" type="password" minlength="8" />
            <label>Confirmar senha</label>
            <input id="confirm" type="password" minlength="8" />
            <button id="togglePassword" class="secondary" type="button">Ver senha</button>
            <button id="submit" type="button">Salvar senha</button>
            <p id="status"></p>
          </main>
          <script>
            const token = ${JSON.stringify(token ?? '')};
            const status = document.getElementById('status');
            document.getElementById('togglePassword').addEventListener('click', function () {
              const passwordInput = document.getElementById('password');
              const confirmInput = document.getElementById('confirm');
              const show = passwordInput.type === 'password';
              passwordInput.type = show ? 'text' : 'password';
              confirmInput.type = show ? 'text' : 'password';
              this.textContent = show ? 'Ocultar senha' : 'Ver senha';
            });
            document.getElementById('submit').addEventListener('click', async function () {
              const password = document.getElementById('password').value;
              const confirm = document.getElementById('confirm').value;
              if (!token) {
                status.textContent = 'Link invalido.';
                return;
              }
              if (password.length < 8 || password !== confirm) {
                status.textContent = 'Confira a senha e a confirmacao.';
                return;
              }
              status.textContent = 'Salvando...';
              const response = await fetch('/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password })
              });
              status.textContent = response.ok ? 'Senha criada. Agora voce ja pode entrar no app.' : 'Nao consegui salvar. O link pode ter expirado.';
            });
          </script>
        </body>
      </html>
    `);
  }

  // 18/08: paginas publicas de Termos de Uso e Politica de Privacidade — precisam de URL de
  // verdade (nao so um texto de checkbox) tanto pra LGPD quanto porque Google Play/App Store
  // exigem link de politica de privacidade pra aceitar apps que coletam dado de saude. Mesmo
  // padrao de HTML estatico ja usado em reset-password acima, sem guarda de autenticacao (tem que
  // ser acessivel por qualquer um, inclusive quem nem se cadastrou ainda).
  @Get('termos-de-uso')
  termsOfUsePage(@Res() response: { type: (value: string) => { send: (value: string) => void } }) {
    response.type('html').send(legalPageHtml('Termos de Uso', TERMS_OF_USE_HTML));
  }

  @Get('politica-privacidade')
  privacyPolicyPage(@Res() response: { type: (value: string) => { send: (value: string) => void } }) {
    response.type('html').send(legalPageHtml('Politica de Privacidade', PRIVACY_POLICY_HTML));
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  me(@Req() req: { user: { sub: string } }) {
    return this.authService.me(req.user.sub);
  }
}

function legalPageHtml(title: string, bodyHtml: string): string {
  return `
    <html>
      <head>
        <title>Panzeri Run - ${title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body { background: #f8fafc; color: #0f172a; font-family: Arial, sans-serif; margin: 0; padding: 24px; line-height: 1.6; }
          main { background: #ffffff; border: 1px solid #dbe4ee; border-radius: 12px; margin: 24px auto; max-width: 640px; padding: 32px; }
          h1 { color: #0f766e; font-size: 22px; }
          h2 { color: #0f766e; font-size: 16px; margin-top: 24px; }
          p, li { color: #334155; font-size: 15px; }
        </style>
      </head>
      <body>
        <main>${bodyHtml}</main>
      </body>
    </html>
  `;
}

const TERMS_OF_USE_HTML = `
  <h1>Termos de Uso — Panzeri Run</h1>
  <h2>1. O que e o Panzeri Run</h2>
  <p>Aplicativo de prescricao e acompanhamento de treinos de corrida, personalizado por metodologia tecnica definida pelo treinador responsavel (Elton Panzeri) e operacionalizado por agentes de inteligencia artificial, sob supervisao tecnica.</p>
  <h2>2. Natureza do servico</h2>
  <p>O acompanhamento e feito a distancia, sem supervisao presencial ou em tempo real durante a execucao dos treinos. O aluno e responsavel por avaliar suas proprias condicoes fisicas a cada sessao e por interromper a atividade e buscar atendimento medico diante de qualquer sinal de risco.</p>
  <h2>3. Nao substitui avaliacao medica</h2>
  <p>O Panzeri Run nao presta servico medico, fisioterapeutico ou de emergencia. Recomenda-se avaliacao medica previa, especialmente para pessoas com condicoes de saude preexistentes.</p>
  <h2>4. Assinatura e pagamento</h2>
  <p>O acesso ao programa de treinos depende de assinatura mensal ativa (R$19,90/mes), processada via Asaas. O cancelamento pode ser feito a qualquer momento, sem multa, produzindo efeito conforme as regras vigentes de cobranca.</p>
  <h2>5. Responsabilidade sobre informacoes</h2>
  <p>O programa de treinos e construido com base nas informacoes fornecidas pelo aluno. Informacoes incompletas, desatualizadas ou incorretas podem comprometer a adequacao e a seguranca do treino prescrito.</p>
  <h2>6. Alteracoes</h2>
  <p>Estes termos podem ser atualizados; alteracoes relevantes serao comunicadas dentro do aplicativo.</p>
  <h2>7. Contato</h2>
  <p>Duvidas: eltonpanzeri@gmail.com</p>
`;

const PRIVACY_POLICY_HTML = `
  <h1>Politica de Privacidade — Panzeri Run</h1>
  <h2>1. Controlador dos dados</h2>
  <p>Elton Panzeri, responsavel pelo Panzeri Run.</p>
  <h2>2. Dados que coletamos</h2>
  <p>Nome, e-mail, telefone, CPF, endereco, data de nascimento; dados de saude e condicionamento fisico (peso, altura, historico de lesoes, dores relatadas, condicoes de saude); historico e desempenho de treinos; dados de pagamento (processados diretamente pelo Asaas, nao armazenamos dados de cartao).</p>
  <h2>3. Para que usamos</h2>
  <p>Personalizar a prescricao de treinos; acompanhar evolucao e seguranca do aluno; processar pagamento da assinatura; comunicacao sobre o servico (e-mail, notificacoes).</p>
  <h2>4. Base legal</h2>
  <p>Execucao de contrato (prestacao do servico) e consentimento explicito, para dados sensiveis de saude.</p>
  <h2>5. Compartilhamento</h2>
  <p>Dados de pagamento com o Asaas (processador de pagamento); dados de treino/saude processados por servicos de inteligencia artificial (Anthropic) para geracao da prescricao, sob contrato de confidencialidade do provedor; e-mails enviados via Resend. Nao vendemos nem compartilhamos dados com terceiros para fins de publicidade.</p>
  <h2>6. Retencao</h2>
  <p>Os dados sao mantidos enquanto a conta estiver ativa e pelo prazo necessario para cumprimento de obrigacoes legais apos o encerramento.</p>
  <h2>7. Seus direitos (LGPD)</h2>
  <p>Acesso, correcao, exclusao, portabilidade e revogacao do consentimento a qualquer momento, mediante solicitacao ao contato abaixo.</p>
  <h2>8. Como pedir a exclusao da sua conta e dos seus dados</h2>
  <p>Envie um e-mail para eltonpanzeri@gmail.com, do mesmo endereco cadastrado no Panzeri Run, com o assunto "Exclusao de conta". Confirmamos o pedido em ate 5 dias uteis e concluimos a exclusao em ate 15 dias.</p>
  <p>Sao excluidos: dados de cadastro (nome, e-mail, telefone, CPF, endereco), dados de saude e condicionamento fisico, historico de treinos prescritos e realizados, e mensagens trocadas com o treinador/agente de IA.</p>
  <p>Sao mantidos, quando exigido por lei, apenas registros de pagamento (nota fiscal/comprovante), pelo prazo minimo exigido pela legislacao fiscal brasileira — nunca usados para nenhum outro fim depois da exclusao da conta.</p>
  <h2>9. Contato</h2>
  <p>eltonpanzeri@gmail.com</p>
`;

