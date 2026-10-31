import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true - necessario pra verificar a assinatura Svix do webhook da Resend
  // (messaging.controller.ts), que precisa do corpo EXATO em bytes, nao o JSON ja reinterpretado.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // 30/10/2026: atras do proxy do EasyPanel, sem isto TODA requisicao chega com o IP do proxy e o limitador de tentativas
  // (login 10/min, esqueci a senha 5/min, cadastro 5/min) passa a ser UM balde compartilhado por todos os alunos: o login e o
  // "Esqueci minha senha" falhavam (429) para quem tentasse no minuto em que outros ja tinham usado o limite.
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  const config = app.get(ConfigService);

  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = Number(process.env.PORT ?? config.get<number>('API_PORT') ?? 3333);
  await app.listen(port, '0.0.0.0');
}

bootstrap();
