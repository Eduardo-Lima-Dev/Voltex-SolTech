import 'reflect-metadata';
import './config/zod-locale';

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { Env } from './config/env';
import { configureApp, setupSwagger } from './setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  setupSwagger(app);

  const port = app.get<ConfigService<Env, true>>(ConfigService).get('API_PORT', { infer: true });
  await app.listen(port);
  app
    .get(Logger)
    .log(
      `API em http://localhost:${port}/api/v1 — documentação em http://localhost:${port}/api/docs`,
    );
}

void bootstrap();
