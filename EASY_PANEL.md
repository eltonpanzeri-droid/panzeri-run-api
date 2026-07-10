# Deploy da API no EasyPanel

Use o PostgreSQL do EasyPanel e suba a API como o servico `panzeri-run-api`.

## Variaveis do servico da API

Configure estas variaveis no EasyPanel:

```text
DATABASE_URL=<URL interna do PostgreSQL>
JWT_ACCESS_SECRET=<crie uma frase longa>
JWT_REFRESH_SECRET=<crie outra frase longa>
API_PORT=3333
MIGRATION_SECRET=<segredo das migracoes>
STRAVA_CLIENT_ID=<id do Strava>
STRAVA_CLIENT_SECRET=<secret do Strava>
STRAVA_REDIRECT_URI=https://agenteselton-panzeri-run-api.hbljgk.easypanel.host/strava/callback
COACH_EMAILS=eltonpanzeri@gmail.com
APP_PUBLIC_URL=https://agenteselton-panzeri-run-api.hbljgk.easypanel.host
```

## Configuracao do servico

- Fonte: GitHub
- Repositorio: `eltonpanzeri-droid/panzeri-run-api`
- Branch: `main`
- Build: Dockerfile
- Caminho do Dockerfile: `Dockerfile`
- Porta interna: `3333`

O Dockerfile da raiz instala somente a API, gera o Prisma Client, compila o NestJS, aplica migracoes e inicia o servidor.

## Teste

Depois de publicado, abra:

```text
https://SEU-DOMINIO-DA-API/health
```

O esperado:

```json
{"status":"ok","service":"panzeri-run-api"}
```
