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

Use o dominio gerado pelo EasyPanel no servico `panzeri-run-app`.

Exemplo:

`https://agenteselton-panzeri-run-app.hbljgk.easypanel.host`

Depois de publicado, use esse link para alunos entrarem no app e instalarem como PWA.

## Como o aluno usa

1. Abrir o link do app no celular.
2. Entrar com e-mail e senha.
3. No navegador do celular, escolher `Adicionar a tela inicial`.

## Observacao

A API continua em:

`https://agenteselton-panzeri-run-api.hbljgk.easypanel.host`
