FROM node:22-bookworm-slim

WORKDIR /app

# postgresql-client-16 (pg_dump) — precisa bater com a versao do servidor (postgres:16, ver
# docker-compose.yml) porque pg_dump nao suporta tirar dump de um servidor MAIS NOVO que ele
# mesmo. O repositorio padrao do Debian bookworm so tem a v15, por isso adiciona o repositorio
# oficial da PostgreSQL (PGDG) pra instalar a v16 certa. Sem isso, BackupService.runBackup() falha
# sempre com "pg_dump: not found" (incidente real 20/08 — a feature existia em codigo desde antes,
# mas nunca funcionou de verdade em producao por faltar essa ferramenta na imagem).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl gnupg lsb-release \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY apps/api/package.json apps/api/pnpm-workspace.yaml ./
RUN pnpm install --no-frozen-lockfile

COPY apps/api/prisma ./prisma
RUN pnpm db:generate

COPY apps/api/tsconfig.json apps/api/nest-cli.json ./
COPY apps/api/src ./src
RUN pnpm build

EXPOSE 3333

CMD ["sh", "-c", "pnpm db:migrate:deploy && pnpm start:prod"]
