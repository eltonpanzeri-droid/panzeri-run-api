# Panzeri Run

Monorepo do Panzeri Run com API, painel do treinador e app do aluno.

## Servicos principais

- API: NestJS + Prisma + PostgreSQL.
- Painel do treinador: Next.js.
- App do aluno: Expo Web/PWA.

## EasyPanel

### API

- Dockerfile: `Dockerfile`
- Porta interna: `3333`
- Health check: `/health`

### App do aluno

- Dockerfile: `apps/mobile/Dockerfile`
- Porta interna: `80`

## Observacao

O `Dockerfile` da raiz e usado para a API no EasyPanel. O Dockerfile de `apps/mobile` e usado somente para o PWA do aluno.
