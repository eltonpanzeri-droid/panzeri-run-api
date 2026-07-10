FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./package.json
RUN npm install --include=dev

COPY prisma ./prisma
RUN npm run db:generate

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

EXPOSE 3333

CMD ["sh", "-c", "npm run db:migrate:deploy && npm run start:prod"]

