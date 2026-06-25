import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth/register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('auth/refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('auth/forgot-password')
  forgotPassword(@Body('email') email: string) {
    return this.authService.startPasswordReset(email);
  }

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
            <button id="submit" type="button">Salvar senha</button>
            <p id="status"></p>
          </main>
          <script>
            const token = ${JSON.stringify(token ?? '')};
            const status = document.getElementById('status');
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

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  me(@Req() req: { user: { sub: string } }) {
    return this.authService.me(req.user.sub);
  }
}
