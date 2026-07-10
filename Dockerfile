FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY apps/api/package.json ./package.json
RUN npm install --include=dev

COPY apps/api/prisma ./prisma
RUN npm run db:generate

COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/nest-cli.json ./
COPY apps/api/src ./src
RUN npm run build

EXPOSE 3333

CMD ["sh", "-c", "npx prisma migrate resolve --rolled-back 20260710120000_add_coupons_and_coach_reports || true; npm run db:migrate:deploy && npm run start:prod"]


