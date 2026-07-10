FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY apps/api/package.json ./package.json
RUN pnpm install --no-frozen-lockfile

COPY apps/api/prisma ./prisma
RUN pnpm db:generate

COPY apps/api/tsconfig.json apps/api/nest-cli.json ./
COPY apps/api/src ./src
RUN pnpm build

EXPOSE 3333

CMD ["sh", "-c", "pnpm db:migrate:deploy && pnpm start:prod"]
