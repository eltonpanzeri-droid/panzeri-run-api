import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Campo de senha (30/10/2026): com "Ver" ligado o campo vira texto comum e o teclado capitalizava a primeira letra, corrigia palavras e acrescentava espaco, mudando a senha digitada
// (login dava "credenciais invalidas"). O campo nunca capitaliza, corrige nem sugere.
const app = readFileSync(join(__dirname, '../../mobile/App.tsx'), 'utf8');
const field = app.slice(app.indexOf('function SecureTextInput'), app.indexOf('function SecureTextInput') + 1400);

describe('campo de senha do aplicativo', () => {
  it('nunca capitaliza, corrige ou sugere, e informa ao gerenciador de senhas se e senha atual ou nova', () => {
    expect(field).toContain('autoCapitalize="none"');
    expect(field).toContain('autoCorrect={false}');
    expect(field).toContain('spellCheck={false}');
    expect(field).toContain("'new-password' : 'current-password'");
  });

  it('o e-mail do login tambem nao e capitalizado nem corrigido; cadastro e redefinicao usam o tipo "nova senha"', () => {
    const login = app.slice(app.indexOf('placeholder="E-mail"') - 80, app.indexOf('placeholder="E-mail"') + 520);
    expect(login).toContain('autoCapitalize="none"');
    expect(login).toContain('autoCorrect={false}');
    expect(app).toContain('placeholder="Nova senha" value={resetPassword} onChangeText={setResetPassword} kind="new"');
    expect(app).toContain('placeholder="Confirmação de senha" value={passwordConfirm} onChangeText={setPasswordConfirm} kind="new"');
  });
});
