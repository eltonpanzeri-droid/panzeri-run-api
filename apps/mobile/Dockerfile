FROM node:22-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/mobile/package.json apps/mobile/package.json

RUN corepack enable
RUN pnpm install --filter @panzeri/mobile... --no-frozen-lockfile

COPY apps/mobile apps/mobile

RUN pnpm --dir apps/mobile exec expo export --platform web --output-dir /app/dist

FROM nginx:1.27-alpine

COPY apps/mobile/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
