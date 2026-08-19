# Deploy do app do aluno

Criar um novo servico no EasyPanel para o PWA do aluno.

## Servico

- Nome sugerido: `panzeri-run-app`
- Fonte: GitHub
- Proprietario: `eltonpanzeri-droid`
- Repositorio: `panzeri-run-api`
- Branch: `main`
- Build: `Dockerfile`
- Caminho do Dockerfile: `apps/mobile/Dockerfile`
- Porta interna: `80`

## Dominio

**Dominio oficial (desde 18/08):** `https://panzerirun.eltonpanzeripersonal.com.br`

Registrado como CNAME em `eltonpanzeripersonal.com.br` (Hostinger, DNS/hPanel) apontando para o
host gerado pelo EasyPanel, e adicionado como dominio (com SSL/Let's Encrypt) no servico
`panzeri-run-app`, marcado como primario. E' esse o link a usar daqui pra frente em convites,
e-mails, mensagens no WhatsApp, etc.

O dominio antigo gerado automaticamente pelo EasyPanel continua ativo e funcionando em paralelo
(nunca foi removido, so deixou de ser o primario) — alunas que ja tinham instalado o PWA usando
esse endereco nao precisam fazer nada:

`https://agenteselton-panzeri-run-app.hbljgk.easypanel.host`

Depois de publicado, use o dominio oficial acima para alunos entrarem no app e instalarem como PWA.

Pra outros links gerados pelo backend (e-mail de recuperacao de prospecto, redirecionamento pos-
Strava) usarem o dominio bonito automaticamente, defina a variavel de ambiente `STUDENT_APP_URL`
no servico `panzeri-run-api`:

`STUDENT_APP_URL=https://panzerirun.eltonpanzeripersonal.com.br`

## Como o aluno usa

1. Abrir o link do app no celular.
2. Entrar com e-mail e senha.
3. No navegador do celular, escolher `Adicionar a tela inicial`.

## Observacao

A API continua em:

`https://agenteselton-panzeri-run-api.hbljgk.easypanel.host`
