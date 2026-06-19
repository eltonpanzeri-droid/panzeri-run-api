FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY apps/api/package.json ./
RUN npm install

COPY apps/api/prisma ./prisma
RUN npm run db:generate

COPY apps/api/tsconfig.json apps/api/nest-cli.json ./
COPY apps/api/src ./src
RUN npm run build

EXPOSE 3333

CMD ["npm", "run", "start:prod"]
