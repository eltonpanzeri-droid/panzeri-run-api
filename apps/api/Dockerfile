FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json ./
RUN pnpm install --no-frozen-lockfile

COPY prisma ./prisma
RUN pnpm db:generate

COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN pnpm build

EXPOSE 3333

CMD ["sh", "-c", "pnpm db:deploy && pnpm start:prod"]
