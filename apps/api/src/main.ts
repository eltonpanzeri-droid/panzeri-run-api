import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true - necessario pra verificar a assinatura Svix do webhook da Resend
  // (messaging.controller.ts), que precisa do corpo EXATO em bytes, nao o JSON ja reinterpretado.
  const app = await NestFactory.create(AppModule, { rawBody: true });
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
