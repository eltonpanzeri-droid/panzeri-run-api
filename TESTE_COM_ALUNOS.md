# Panzeri Run - teste com alunos

## Antes de convidar alunos

No EasyPanel, em `panzeri-run-api > Ambiente`, mantenha estas variaveis:

```env
COACH_EMAILS=eltonpanzeri@gmail.com
APP_PUBLIC_URL=https://agenteselton-panzeri-run-api.hbljgk.easypanel.host
```

`COACH_EMAILS` define quais e-mails podem entrar no painel do treinador.

## Fluxo recomendado

1. Entrar no painel do treinador.
2. Criar aluno com nome e e-mail.
3. Deixar a senha em branco.
4. O painel copia o convite automaticamente.
5. Enviar o convite ao aluno.
6. O aluno cria a propria senha.
7. O aluno entra no app e preenche anamnese, teste e rotina.

## Links uteis

- Termos: `https://agenteselton-panzeri-run-api.hbljgk.easypanel.host/legal/terms`
- Privacidade: `https://agenteselton-panzeri-run-api.hbljgk.easypanel.host/legal/privacy`
- Recuperacao/criacao de senha: o painel gera o link individual.

## Limites desta primeira rodada

- O envio de e-mail automatico ainda nao esta ligado. Por enquanto, o convite e copiado para envio manual.
- O app do aluno ja esta preparado como PWA, mas ainda precisa de um deploy publico do frontend.
- Backup do banco deve ser conferido no EasyPanel/PostgreSQL antes de colocar muitos alunos.
