FROM node:22-alpine AS build

WORKDIR /app

COPY apps/mobile/package.json ./

RUN npm install --legacy-peer-deps

COPY apps/mobile ./

RUN npx expo export --platform web --output-dir /app/dist

FROM nginx:1.27-alpine

COPY --from=build /app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
