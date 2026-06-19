FROM node:20-alpine

WORKDIR /app

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
