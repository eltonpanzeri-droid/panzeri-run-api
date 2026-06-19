# Deploy da API no EasyPanel

Use o PostgreSQL do EasyPanel e suba a API como um novo serviço.

## Variaveis do serviço da API

Configure estas variaveis no EasyPanel:

```text
DATABASE_URL=<URL interna do PostgreSQL>
JWT_ACCESS_SECRET=<crie uma frase longa>
JWT_REFRESH_SECRET=<crie outra frase longa>
API_PORT=3333
```

## Configuracao do serviço

- Build: Dockerfile
- Dockerfile: `apps/api/Dockerfile`
- Porta interna: `3333`

Quando a API subir, ela executa as migracoes do Prisma e inicia o servidor.

## Teste

Depois de publicado, abra:

```text
https://SEU-DOMINIO-DA-API/health
```

O esperado:

```json
{"status":"ok","service":"panzeri-run-api"}
```
