FROM node:20-alpine

WORKDIR /app

RUN corepack enable

COPY . .
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @panzeri/api db:generate
RUN pnpm --filter @panzeri/api build

EXPOSE 3333

CMD ["sh", "-c", "pnpm --filter @panzeri/api db:deploy && pnpm --filter @panzeri/api start:prod"]
