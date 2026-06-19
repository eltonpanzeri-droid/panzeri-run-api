FROM node:22-alpine

WORKDIR /app

COPY apps/api/package.json ./
RUN npm install

COPY apps/api/prisma ./prisma
RUN npm run db:generate

COPY apps/api/tsconfig.json apps/api/nest-cli.json ./
COPY apps/api/src ./src
RUN npm run build

EXPOSE 3333

CMD ["sh", "-c", "npm run db:deploy && npm run start:prod"]
